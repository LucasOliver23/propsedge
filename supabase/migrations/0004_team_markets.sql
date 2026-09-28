-- =====================================================================
-- Mercados de TIME e de JOGO (escanteios, gols, 1º tempo, faltas, chutes,
-- cartões, laterais, pontos por quarto etc.) + picks do dia + recap da rodada
-- =====================================================================

-- ---------------------------------------------------------------------
-- Estatística por time/jogo (inclui parciais: goals_1h, points_q1, runs_f5...)
-- ---------------------------------------------------------------------
create table team_game_stats (
  team_id          bigint not null references teams(id),
  game_id          bigint not null references games(id) on delete cascade,
  game_date        date   not null,
  sport_id         text   not null,
  opponent_team_id bigint not null,
  is_home          boolean not null,
  stats            jsonb  not null default '{}',
  updated_at       timestamptz not null default now(),
  primary key (team_id, game_id)
);
create index tgs_team_recent_idx on team_game_stats (team_id, game_date desc) include (stats, opponent_team_id, is_home);
create index tgs_opp_idx         on team_game_stats (opponent_team_id, game_date desc);
create index tgs_sport_date_idx  on team_game_stats (sport_id, game_date desc);

create table live_team_stats (
  game_id    bigint not null references games(id) on delete cascade,
  team_id    bigint not null references teams(id),
  stats      jsonb  not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (game_id, team_id)
);

-- Catálogo de mercados de time por esporte
create table team_market_types (
  sport_id text not null references sports(id),
  key      text not null,
  label    text not null,
  priority smallint not null default 5,
  primary key (sport_id, key)
);

insert into team_market_types (sport_id, key, label, priority) values
  ('soccer','goals','Gols',1),
  ('soccer','goals_1h','Gols 1º tempo',1),
  ('soccer','goals_2h','Gols 2º tempo',2),
  ('soccer','corners','Escanteios',1),
  ('soccer','fouls','Faltas',2),
  ('soccer','shots','Chutes',2),
  ('soccer','shots_on_target','Chutes no gol',2),
  ('soccer','cards','Cartões',2),
  ('soccer','offsides','Impedimentos',3),
  ('soccer','throw_ins','Laterais',3),
  ('soccer','saves','Defesas do goleiro',4),
  ('soccer','passes','Passes',4),
  ('nba','points','Pontos',1), ('nba','points_1h','Pontos 1º tempo',1), ('nba','points_q1','Pontos 1º quarto',2),
  ('nba','rebounds','Rebotes',2), ('nba','assists','Assistências',3), ('nba','threes','Cestas de 3',2),
  ('wnba','points','Pontos',1), ('wnba','points_1h','Pontos 1º tempo',1), ('wnba','points_q1','Pontos 1º quarto',2),
  ('wnba','rebounds','Rebotes',2), ('wnba','threes','Cestas de 3',2),
  ('ncaab','points','Pontos',1), ('ncaab','points_1h','Pontos 1º tempo',1),
  ('nfl','points','Pontos',1), ('nfl','points_1h','Pontos 1º tempo',1), ('nfl','total_yards','Jardas totais',2),
  ('nfl','rush_yds','Jardas corrida',3), ('nfl','pass_yds','Jardas passe',3),
  ('mlb','runs','Corridas',1), ('mlb','runs_f5','Corridas 5 entradas',1), ('mlb','hits','Rebatidas',2),
  ('nhl','goals','Gols',1), ('nhl','goals_p1','Gols 1º período',2), ('nhl','shots','Chutes a gol',2);

-- ---------------------------------------------------------------------
-- Análise pré-calculada por jogo x mercado x sujeito (home | away | match)
-- `data` guarda as séries (L20, H2H, casa/fora, temporada) para o front
-- recalcular tudo quando o usuário mexe na linha.
-- ---------------------------------------------------------------------
create table team_market_analytics (
  game_id        bigint not null references games(id) on delete cascade,
  subject        text   not null check (subject in ('home','away','match')),
  stat_key       text   not null,
  team_id        bigint references teams(id),
  default_line   numeric(7,2) not null,
  default_side   bet_side not null,
  projection     numeric(8,2),
  model_prob     numeric(5,4),
  score          smallint not null,
  hit_l10        numeric(5,4),
  matchup_grade  char(1),
  matchup_factor numeric(6,4),
  data           jsonb not null default '{}',
  computed_at    timestamptz not null default now(),
  primary key (game_id, subject, stat_key)
);
create index tma_score_idx on team_market_analytics (score desc);

-- Picks do dia (snapshot antes do jogo) -> base do "recap da rodada"
create table team_picks (
  id           bigint generated always as identity primary key,
  game_id      bigint not null references games(id) on delete cascade,
  subject      text   not null,
  team_id      bigint references teams(id),
  stat_key     text   not null,
  side         bet_side not null,
  line         numeric(7,2) not null,
  score        smallint not null,
  model_prob   numeric(5,4),
  status       bet_status not null default 'pending',
  result_value numeric(8,2),
  created_at   timestamptz not null default now(),
  settled_at   timestamptz,
  unique (game_id, subject, stat_key)
);
create index team_picks_open_idx on team_picks (game_id) where status = 'pending';

-- ---------------------------------------------------------------------
-- Bilheteira: apostas de jogador, de time ou de jogo (total)
-- ---------------------------------------------------------------------
alter table tracked_bets alter column market_id drop not null;
alter table tracked_bets alter column player_id drop not null;
alter table tracked_bets add column kind text not null default 'player'
  check (kind in ('player','team','match'));
alter table tracked_bets add column team_id bigint references teams(id);
alter table tracked_bets add constraint tracked_bets_kind_ck check (
  (kind = 'player' and player_id is not null) or
  (kind = 'team'   and team_id   is not null) or
  (kind = 'match')
);

-- Valor final de um mercado de time/jogo
create or replace function team_stat_value(p_game_id bigint, p_kind text, p_team_id bigint, p_stat text)
returns numeric language sql stable as $$
  select case
    when p_kind = 'team' then
      (select (stats ->> p_stat)::numeric from team_game_stats where game_id = p_game_id and team_id = p_team_id)
    when p_kind = 'match' then
      (select case when count(*) = 2 and count(stats ->> p_stat) = 2
                   then sum((stats ->> p_stat)::numeric) end
       from team_game_stats where game_id = p_game_id)
  end
$$;

-- Fixar mercado de time/jogo com a odd que o usuário encontrou na casa dele
create or replace function track_team_market(
  p_game_id  bigint,
  p_kind     text,        -- 'team' | 'match'
  p_team_id  bigint,      -- obrigatório se kind = 'team'
  p_stat_key text,
  p_side     bet_side,
  p_line     numeric,
  p_odds     numeric,
  p_stake    numeric default null,
  p_bookmaker text default null
) returns tracked_bets
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_game games;
  v_prof profiles;
  v_stake numeric;
  v_an   team_market_analytics;
  v_bet  tracked_bets;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_kind not in ('team','match') then raise exception 'invalid_kind'; end if;
  if p_odds is null or p_odds <= 1 or p_odds > 100 then raise exception 'invalid_odds'; end if;
  if p_line is null or p_line < 0 then raise exception 'invalid_line'; end if;

  select * into v_game from games where id = p_game_id;
  if not found then raise exception 'market_not_found'; end if;
  if v_game.status <> 'scheduled' or v_game.start_time <= now() then raise exception 'game_already_started'; end if;
  if not exists (select 1 from team_market_types where sport_id = v_game.sport_id and key = p_stat_key) then
    raise exception 'market_not_found';
  end if;
  if p_kind = 'team' and p_team_id not in (v_game.home_team_id, v_game.away_team_id) then
    raise exception 'market_not_found';
  end if;

  select * into v_an from team_market_analytics
  where game_id = p_game_id and stat_key = p_stat_key
    and subject = case when p_kind = 'match' then 'match'
                       when p_team_id = v_game.home_team_id then 'home' else 'away' end;

  select * into v_prof from profiles where id = v_uid for update;
  v_stake := round(coalesce(p_stake, v_prof.unit_size), 2);
  if v_stake <= 0 or v_stake > v_prof.bankroll then raise exception 'insufficient_bankroll'; end if;

  insert into tracked_bets (user_id, kind, game_id, team_id, stat_key, side, line, odds, bookmaker_id,
                            stake, confidence_at_pick)
  values (v_uid, p_kind, p_game_id, case when p_kind = 'team' then p_team_id end, p_stat_key, p_side,
          p_line, round(p_odds, 3), p_bookmaker, v_stake, v_an.score)
  returning * into v_bet;

  update profiles set bankroll = bankroll - v_stake where id = v_uid;
  insert into bankroll_ledger (user_id, bet_id, amount, reason, balance_after)
  values (v_uid, v_bet.id, -v_stake, 'stake', v_prof.bankroll - v_stake);
  return v_bet;
end $$;

-- ---------------------------------------------------------------------
-- Liquidação (substitui a versão da 0002): jogador + time + jogo + picks
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
             when b.kind = 'player' then
               case when pgs.player_id is null or pgs.dnp then null
                    else (pgs.stats ->> b.stat_key)::numeric end
             else team_stat_value(b.game_id, b.kind, b.team_id, b.stat_key)
           end as val
    from tracked_bets b
    left join player_game_stats pgs
           on b.kind = 'player' and pgs.player_id = b.player_id and pgs.game_id = b.game_id
    where b.game_id = p_game_id and b.status in ('pending','live')
    for update of b
  ), graded as (
    select *,
      case
        when val is null                    then 'void'::bet_status
        when val = line                     then 'push'::bet_status
        when (side = 'over') = (val > line) then 'green'::bet_status
        else                                     'red'::bet_status
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

  -- picks do dia
  update team_picks p
     set result_value = r.val,
         status = case
                    when r.val is null                    then 'void'::bet_status
                    when r.val = p.line                   then 'push'::bet_status
                    when (p.side = 'over') = (r.val > p.line) then 'green'::bet_status
                    else                                       'red'::bet_status
                  end,
         settled_at = now()
    from (
      select id,
             case when v_game.status = 'cancelled' then null
                  else team_stat_value(game_id, case when subject = 'match' then 'match' else 'team' end,
                                       team_id, stat_key) end as val
      from team_picks where game_id = p_game_id and status = 'pending'
    ) r
   where p.id = r.id;

  return v_count;
end $$;

create or replace function settle_pending_games() returns int
language plpgsql security definer set search_path = public as $$
declare r record; total int := 0;
begin
  for r in
    select g.id from games g
    where ((g.status = 'final' and g.stats_final) or g.status = 'cancelled')
      and (exists (select 1 from tracked_bets b where b.game_id = g.id and b.status in ('pending','live'))
           or exists (select 1 from team_picks p where p.game_id = g.id and p.status = 'pending'))
  loop
    total := total + settle_game(r.id);
  end loop;
  return total;
end $$;

-- ---------------------------------------------------------------------
-- VIEWS
-- ---------------------------------------------------------------------
create or replace view v_team_board with (security_invoker = true) as
select
  a.game_id, a.subject, a.stat_key, mt.label as stat_label, mt.priority,
  a.team_id, t.name as team_name, t.abbr as team_abbr, t.logo_url as team_logo,
  a.default_line, a.default_side, a.projection, a.model_prob, a.score, a.hit_l10,
  a.matchup_grade, a.matchup_factor, a.data, a.computed_at,
  g.sport_id, g.start_time, g.status as game_status,
  g.external_ids ->> 'espn_path' as league_slug,
  g.home_team_id, ht.name as home_name, ht.abbr as home_abbr, ht.logo_url as home_logo,
  g.away_team_id, at.name as away_name, at.abbr as away_abbr, at.logo_url as away_logo
from team_market_analytics a
join games g on g.id = a.game_id
join teams ht on ht.id = g.home_team_id
join teams at on at.id = g.away_team_id
left join teams t on t.id = a.team_id
left join team_market_types mt on mt.sport_id = g.sport_id and mt.key = a.stat_key
where g.status in ('scheduled','live')
  and g.start_time < now() + interval '72 hours';

drop view if exists v_my_bets;
create view v_my_bets with (security_invoker = true) as
select b.*,
       coalesce(p.name, bt.name, ht.abbr || ' x ' || at.abbr) as player_name,
       coalesce(st.label, mt.label, b.stat_key) ||
         case b.kind when 'match' then ' (jogo)' else '' end      as stat_label,
       g.status as game_status, g.start_time, g.period, g.clock, g.home_score, g.away_score,
       ht.abbr as home_abbr, at.abbr as away_abbr,
       case b.kind
         when 'player' then (lps.stats ->> b.stat_key)::numeric
         when 'team'   then (select (l.stats ->> b.stat_key)::numeric from live_team_stats l
                             where l.game_id = b.game_id and l.team_id = b.team_id)
         else (select sum((l.stats ->> b.stat_key)::numeric) from live_team_stats l where l.game_id = b.game_id)
       end as live_value
from tracked_bets b
join games g  on g.id = b.game_id
join teams ht on ht.id = g.home_team_id
join teams at on at.id = g.away_team_id
left join players p  on p.id = b.player_id
left join teams bt   on bt.id = b.team_id
left join stat_types st on b.kind = 'player' and st.sport_id = g.sport_id and st.key = b.stat_key
left join team_market_types mt on b.kind <> 'player' and mt.sport_id = g.sport_id and mt.key = b.stat_key
left join live_player_stats lps on b.kind = 'player' and lps.game_id = b.game_id and lps.player_id = b.player_id;

-- Recap da rodada (dia em horário de Brasília)
create or replace view v_picks_recap with (security_invoker = true) as
select (g.start_time at time zone 'America/Sao_Paulo')::date as dia,
       g.sport_id, p.stat_key, coalesce(mt.label, p.stat_key) as stat_label, p.subject,
       count(*)                                     as entries,
       count(*) filter (where p.status = 'green')   as greens,
       count(*) filter (where p.status = 'red')     as reds
from team_picks p
join games g on g.id = p.game_id
left join team_market_types mt on mt.sport_id = g.sport_id and mt.key = p.stat_key
where p.status in ('green','red')
group by 1,2,3,4,5;

-- Lista detalhada dos picks (para o recap e para conferir)
create or replace view v_picks with (security_invoker = true) as
select p.*, (g.start_time at time zone 'America/Sao_Paulo')::date as dia, g.sport_id, g.start_time,
       g.external_ids ->> 'espn_path' as league_slug,
       coalesce(mt.label, p.stat_key) as stat_label,
       t.name as team_name, ht.name as home_name, at.name as away_name
from team_picks p
join games g on g.id = p.game_id
join teams ht on ht.id = g.home_team_id
join teams at on at.id = g.away_team_id
left join teams t on t.id = p.team_id
left join team_market_types mt on mt.sport_id = g.sport_id and mt.key = p.stat_key;

-- ---------------------------------------------------------------------
-- Segurança e Realtime
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['team_game_stats','live_team_stats','team_market_types',
                           'team_market_analytics','team_picks'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "public read" on %I for select to anon, authenticated using (true)', t);
  end loop;
end $$;

grant select on team_game_stats, live_team_stats, team_market_types, team_market_analytics, team_picks
  to anon, authenticated;
grant select on v_team_board, v_picks_recap, v_picks to anon, authenticated;
grant select on v_my_bets to authenticated;
grant execute on function track_team_market(bigint, text, bigint, text, bet_side, numeric, numeric, numeric, text) to authenticated;
revoke execute on function settle_game(bigint)    from public, anon, authenticated;
revoke execute on function settle_pending_games() from public, anon, authenticated;

alter publication supabase_realtime add table live_team_stats;
