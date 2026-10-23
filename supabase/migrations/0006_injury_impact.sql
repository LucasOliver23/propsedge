-- Impacto de Lesões: expõe os desfalques de OUTROS jogadores do time e do
-- adversário na v_props_board (o jogador da prop em si já tinha injury_status/
-- injury_detail). Reaproveita a tabela player_injuries, já coletada pelo
-- worker via sync_context.py — nenhuma fonte de dado nova.
-- Baseado na definição ATUAL da view em produção (via pg_get_viewdef), que já
-- diverge das migrations antigas no repo (line_source, injury_status,
-- injury_detail, confirmed_starter, batting_order foram adicionados depois).
-- Idempotente: pode rodar mais de uma vez.

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
  pa.computed_at,
  pa.line_source,
  inj.status as injury_status,
  inj.detail as injury_detail,
  (exists (select 1 from game_lineups lu where lu.game_id = g.id and lu.player_id = p.id)) as confirmed_starter,
  (select min(lu.batting_order) from game_lineups lu where lu.game_id = g.id and lu.player_id = p.id) as batting_order,
  (
    select jsonb_agg(jsonb_build_object(
             'name', i.name, 'position', i.position, 'status', i.status, 'detail', i.detail)
           order by case when lower(i.status) ~ 'out|il|suspen|doubtful' then 0 else 1 end, i.name)
    from player_injuries i
    where i.team_id = p.team_id and i.player_id is distinct from p.id
  ) as team_injuries,
  (
    select jsonb_agg(jsonb_build_object(
             'name', i.name, 'position', i.position, 'status', i.status, 'detail', i.detail)
           order by case when lower(i.status) ~ 'out|il|suspen|doubtful' then 0 else 1 end, i.name)
    from player_injuries i
    where i.team_id = opp.id
  ) as opp_injuries
from prop_analytics pa
join prop_markets m on m.id = pa.market_id
join games g        on g.id = m.game_id
join players p      on p.id = m.player_id
join teams t        on t.id = p.team_id
join teams opp      on opp.id = case when p.team_id = g.home_team_id then g.away_team_id else g.home_team_id end
left join stat_types st on st.sport_id = m.sport_id and st.key = m.stat_key
left join lateral (
  select i.status, i.detail from player_injuries i where i.player_id = p.id order by i.updated_at desc limit 1
) inj on true
where g.status in ('scheduled','live')
  and g.start_time < now() + interval '36 hours';

grant select on v_props_board to anon, authenticated;
