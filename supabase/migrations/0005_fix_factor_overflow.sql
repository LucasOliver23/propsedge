-- Corrige "numeric field overflow" no refresh_dvp (fator > 99 quando a média da liga é ~0)
-- Idempotente: pode rodar mais de uma vez.
alter table team_defense_vs_position alter column factor type numeric(10,4);
-- v_team_board depende da coluna: recria a view em volta da alteração
drop view if exists v_team_board;
alter table team_market_analytics   alter column matchup_factor type numeric(10,4);
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
grant select on v_team_board to anon, authenticated;

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
         -- estatísticas raras (média ~0) geram fatores absurdos: limita entre 0.2 e 5
         least(greatest(coalesce(a.allowed_avg / nullif(lg.league_avg, 0), 1), 0.2), 5),
         rank() over (partition by a.sport_id, a.position, a.stat_key order by a.allowed_avg asc),
         now()
  from agg a join lg using (sport_id, position, stat_key)
  on conflict (team_id, position, stat_key) do update
    set games = excluded.games, allowed_avg = excluded.allowed_avg, league_avg = excluded.league_avg,
        factor = excluded.factor, rank = excluded.rank, updated_at = now();
$$;
revoke execute on function refresh_dvp(int) from public, anon, authenticated;
