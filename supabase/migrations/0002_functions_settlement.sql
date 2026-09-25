-- =====================================================================
-- Funções de negócio: matching, DvP, bilheteira e liquidação automática
-- =====================================================================

-- ---------------------------------------------------------------------
-- Matching de nomes vindos das APIs (odds usam nomes, stats usam IDs)
-- ---------------------------------------------------------------------
create or replace function match_player(p_name text, p_team_ids bigint[], p_min_sim real default 0.55)
returns bigint language sql stable as $$
  select id
  from players
  where team_id = any(p_team_ids)
    and similarity(name_norm, lower(unaccent(p_name))) >= p_min_sim
  order by similarity(name_norm, lower(unaccent(p_name))) desc
  limit 1
$$;

-- ---------------------------------------------------------------------
-- DvP: recalcula quanto cada defesa cede por posição/estatística (últimos 120 dias)
-- Rodar 1x/dia (pg_cron no fim do arquivo)
-- ---------------------------------------------------------------------
create or replace function refresh_dvp(p_days int default 120) returns void
language sql as $$
  with per_game as (
    select pgs.sport_id, pgs.opponent_team_id as team_id, pgs.position, s.key as stat_key,
           pgs.game_id, sum(s.value::numeric) as allowed
    from player_game_stats pgs
    cross join lateral jsonb_each_text(pgs.stats) s
    where pgs.game_date >= current_date - p_days
      and not pgs.dnp
      and pgs.position is not null
      and s.value ~ '^-?[0-9]+(\.[0-9]+)?$'
    group by 1,2,3,4,5
  ), agg as (
    select sport_id, team_id, position, stat_key, count(*)::int as games, avg(allowed) as allowed_avg
    from per_game group by 1,2,3,4
    having count(*) >= 3
  ), lg as (
    select sport_id, position, stat_key, avg(allowed_avg) as league_avg
    from agg group by 1,2,3
  )
  insert into team_defense_vs_position
    (sport_id, team_id, position, stat_key, games, allowed_avg, league_avg, factor, rank, updated_at)
  select a.sport_id, a.team_id, a.position, a.stat_key, a.games, a.allowed_avg, lg.league_avg,
         coalesce(a.allowed_avg / nullif(lg.league_avg, 0), 1),
         rank() over (partition by a.sport_id, a.position, a.stat_key order by a.allowed_avg asc),
         now()
  from agg a join lg using (sport_id, position, stat_key)
  on conflict (team_id, position, stat_key) do update
    set games = excluded.games, allowed_avg = excluded.allowed_avg, league_avg = excluded.league_avg,
        factor = excluded.factor, rank = excluded.rank, updated_at = now();
$$;

-- ---------------------------------------------------------------------
-- Plano do usuário (usado p/ esconder recursos premium nas views)
-- ---------------------------------------------------------------------
create or replace function is_premium() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select plan <> 'free' from profiles where id = auth.uid()), false)
$$;

-- ---------------------------------------------------------------------
-- BILHETEIRA: fixar uma prop (debita stake do bankroll virtual)
-- ---------------------------------------------------------------------
create or replace function track_prop(
  p_market_id bigint,
  p_side      bet_side,
  p_stake     numeric default null,
  p_bookmaker text default null
) returns tracked_bets
language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_prof   profiles;
  v_mkt    prop_markets;
  v_game   games;
  v_odds   record;
  v_an     prop_analytics;
  v_stake  numeric;
  v_bet    tracked_bets;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  select * into v_mkt  from prop_markets where id = p_market_id;
  if not found then raise exception 'market_not_found'; end if;

  select * into v_game from games where id = v_mkt.game_id;
  if v_game.status <> 'scheduled' or v_game.start_time <= now() then
    raise exception 'game_already_started';
  end if;

  -- odd escolhida: casa informada ou a melhor disponível para o lado
  select o.bookmaker_id, o.line,
         case when p_side = 'over' then o.over_odds else o.under_odds end as price
    into v_odds
  from odds_current o
  where o.market_id = p_market_id
    and (p_bookmaker is null or o.bookmaker_id = p_bookmaker)
    and (case when p_side = 'over' then o.over_odds else o.under_odds end) is not null
  order by price desc
  limit 1;
  if v_odds is null then raise exception 'no_odds_available'; end if;

  select * into v_an from prop_analytics where market_id = p_market_id and side = p_side;

  select * into v_prof from profiles where id = v_uid for update;
  v_stake := round(coalesce(p_stake, v_prof.unit_size), 2);
  if v_stake <= 0 or v_stake > v_prof.bankroll then raise exception 'insufficient_bankroll'; end if;

  insert into tracked_bets (user_id, market_id, game_id, player_id, stat_key, side, line, odds,
                            bookmaker_id, stake, confidence_at_pick, ev_at_pick)
  values (v_uid, p_market_id, v_mkt.game_id, v_mkt.player_id, v_mkt.stat_key, p_side, v_odds.line,
          v_odds.price, v_odds.bookmaker_id, v_stake, v_an.confidence, v_an.ev)
  returning * into v_bet;

  update profiles set bankroll = bankroll - v_stake where id = v_uid;
  insert into bankroll_ledger (user_id, bet_id, amount, reason, balance_after)
  values (v_uid, v_bet.id, -v_stake, 'stake', v_prof.bankroll - v_stake);

  return v_bet;
end $$;

-- Desafixar antes do início (estorna)
create or replace function untrack_bet(p_bet_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_bet tracked_bets; v_bal numeric;
begin
  select b.* into v_bet from tracked_bets b join games g on g.id = b.game_id
  where b.id = p_bet_id and b.user_id = auth.uid() and b.status = 'pending' and g.status = 'scheduled'
  for update of b;
  if not found then raise exception 'cannot_untrack'; end if;

  update profiles set bankroll = bankroll + v_bet.stake where id = v_bet.user_id returning bankroll into v_bal;
  -- aposta nunca "existiu": remove o lançamento de stake e a própria aposta
  delete from bankroll_ledger where bet_id = v_bet.id;
  delete from tracked_bets where id = v_bet.id;
end $$;

-- ---------------------------------------------------------------------
-- AUTO GREEN / RED
-- Liquida TODAS as apostas abertas de um jogo em uma única instrução (set-based,
-- idempotente: só toca apostas 'pending'/'live').
-- Regras:
--   * jogo cancelado            -> void (estorno)
--   * jogador não jogou (DNP)   -> void (padrão da maioria das casas)
--   * valor > linha  -> over green / under red ; valor = linha -> push
-- ---------------------------------------------------------------------
create or replace function settle_game(p_game_id bigint) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_game  games;
  v_count int;
begin
  select * into v_game from games where id = p_game_id;
  if v_game.status not in ('final','cancelled') then return 0; end if;
  if v_game.status = 'final' and not v_game.stats_final then return 0; end if;

  with res as (
    select b.id, b.user_id, b.stake, b.odds, b.side, b.line,
           case
             when v_game.status = 'cancelled' then null
             when pgs.player_id is null or pgs.dnp then null
             else (pgs.stats ->> b.stat_key)::numeric
           end as val
    from tracked_bets b
    left join player_game_stats pgs
           on pgs.player_id = b.player_id and pgs.game_id = b.game_id
    where b.game_id = p_game_id and b.status in ('pending','live')
    for update of b
  ), graded as (
    select *,
      case
        when val is null                                   then 'void'::bet_status
        when val = line                                    then 'push'::bet_status
        when (side = 'over') = (val > line)                then 'green'::bet_status
        else                                                    'red'::bet_status
      end as new_status
    from res
  ), upd as (
    update tracked_bets t
       set status       = g.new_status,
           result_value = g.val,
           profit       = case g.new_status when 'green' then round(g.stake * (g.odds - 1), 2)
                                            when 'red'   then -g.stake
                                            else 0 end,
           settled_at   = now()
      from graded g
     where t.id = g.id
    returning t.id, t.user_id, t.status,
              case t.status when 'green' then round(t.stake * t.odds, 2)
                            when 'push'  then t.stake
                            when 'void'  then t.stake
                            else 0 end as payout
  ), totals as (
    select user_id, sum(payout) as total from upd group by user_id
  ), prof as (
    update profiles p set bankroll = p.bankroll + t.total
      from totals t where p.id = t.user_id and t.total > 0
    returning p.id, p.bankroll
  ), led as (
    insert into bankroll_ledger (user_id, bet_id, amount, reason, balance_after)
    select u.user_id, u.id, u.payout, case u.status when 'green' then 'payout' else 'refund' end,
           coalesce(pr.bankroll, 0)
    from upd u left join prof pr on pr.id = u.user_id
    where u.payout > 0
    returning 1
  )
  select count(*) into v_count from upd;

  return v_count;
end $$;

-- Rede de segurança: liquida qualquer jogo final que ainda tenha apostas abertas
create or replace function settle_pending_games() returns int
language plpgsql security definer set search_path = public as $$
declare r record; total int := 0;
begin
  for r in
    select distinct b.game_id from tracked_bets b join games g on g.id = b.game_id
    where b.status in ('pending','live')
      and ((g.status = 'final' and g.stats_final) or g.status = 'cancelled')
  loop
    total := total + settle_game(r.game_id);
  end loop;
  return total;
end $$;

-- ---------------------------------------------------------------------
-- Trigger: reage à mudança de status do jogo (o worker só atualiza "games")
-- ---------------------------------------------------------------------
-- updated_at automático
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger games_touch before update on games
  for each row execute function touch_updated_at();

create or replace function on_game_status_change_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'live' and old.status = 'scheduled' then
    update tracked_bets set status = 'live' where game_id = new.id and status = 'pending';
  end if;
  if (new.status = 'final' and new.stats_final and not (old.status = 'final' and old.stats_final))
     or (new.status = 'cancelled' and old.status <> 'cancelled') then
    perform settle_game(new.id);
  end if;
  return null;
end $$;

-- AFTER: settle_game precisa enxergar o novo status ao ler "games"
create trigger games_settle after update of status, stats_final on games
  for each row execute function on_game_status_change_after();

-- ---------------------------------------------------------------------
-- VIEW do painel (o front lê só daqui). security_invoker respeita RLS.
-- EV e comparador ficam mascarados para plano free.
-- ---------------------------------------------------------------------
create or replace view v_props_board with (security_invoker = true) as
select
  pa.market_id, pa.side, pa.line,
  m.sport_id, m.stat_key, st.label as stat_label,
  g.id as game_id, g.start_time, g.status as game_status,
  p.id as player_id, p.name as player_name, p.position, p.headshot_url, p.status as player_status,
  t.abbr as team_abbr, opp.abbr as opp_abbr, opp.id as opp_team_id,
  (p.team_id = g.home_team_id) as is_home,
  pa.l5_hits, pa.l5_n, pa.l10_hits, pa.l10_n, pa.l20_hits, pa.l20_n, pa.h2h_hits, pa.h2h_n,
  pa.season_avg, pa.l10_values, pa.l10_opps, pa.dvp_rank, pa.dvp_factor, pa.proj_mean,
  pa.model_prob, pa.confidence,
  pa.best_book, pa.best_odds,
  case when is_premium() then pa.ev end          as ev,
  case when is_premium() then pa.fair_prob end   as fair_prob,
  case when is_premium() then (
    select jsonb_agg(jsonb_build_object(
             'book', o.bookmaker_id, 'line', o.line,
             'odds', case when pa.side = 'over' then o.over_odds else o.under_odds end)
           order by case when pa.side = 'over' then o.over_odds else o.under_odds end desc nulls last)
    from odds_current o where o.market_id = pa.market_id
  ) end as books,
  pa.computed_at
from prop_analytics pa
join prop_markets m on m.id = pa.market_id
join games g        on g.id = m.game_id
join players p      on p.id = m.player_id
join teams t        on t.id = p.team_id
join teams opp      on opp.id = case when p.team_id = g.home_team_id then g.away_team_id else g.home_team_id end
left join stat_types st on st.sport_id = m.sport_id and st.key = m.stat_key
where g.status in ('scheduled','live')
  and g.start_time < now() + interval '36 hours';

-- Bilheteira do usuário com dados do jogo (RLS de tracked_bets aplica via security_invoker)
create or replace view v_my_bets with (security_invoker = true) as
select b.*, p.name as player_name, st.label as stat_label,
       g.status as game_status, g.start_time, g.period, g.clock, g.home_score, g.away_score,
       ht.abbr as home_abbr, at.abbr as away_abbr,
       (lps.stats ->> b.stat_key)::numeric as live_value
from tracked_bets b
join players p on p.id = b.player_id
join games g   on g.id = b.game_id
join teams ht  on ht.id = g.home_team_id
join teams at  on at.id = g.away_team_id
left join stat_types st on st.sport_id = g.sport_id and st.key = b.stat_key
left join live_player_stats lps on lps.game_id = b.game_id and lps.player_id = b.player_id;
