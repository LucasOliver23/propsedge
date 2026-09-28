-- Raio-X do banco depois da carga (aparece no log do GitHub Actions)
\echo '=== Jogos por esporte/status ==='
select sport_id, status, count(*) from games group by 1,2 order by 1,2;
\echo '=== Histórico de estatísticas ==='
select sport_id, count(*) as linhas, count(distinct player_id) as jogadores, min(game_date), max(game_date)
from player_game_stats group by 1 order by 1;
\echo '=== Estatísticas encontradas por esporte (confira se os mercados existem) ==='
select sport_id, string_agg(distinct k, ', ' order by k) as chaves
from (select sport_id, jsonb_object_keys(stats) k from player_game_stats where game_date > current_date - 40) x
group by 1 order by 1;
\echo '=== DvP ==='
select sport_id, count(*) from team_defense_vs_position group by 1 order by 1;
\echo '=== Props, odds e análises (próximas 36h) ==='
select m.sport_id, count(distinct m.id) as mercados, count(distinct o.bookmaker_id) as casas,
       count(distinct pa.market_id) as analisados, round(avg(pa.confidence)) as conf_media,
       count(distinct (pa.market_id, pa.side)) filter (where pa.ev >= 0.03) as ev_plus
from prop_markets m
join games g on g.id = m.game_id and g.start_time > now() - interval '6 hours'
left join odds_current o on o.market_id = m.id
left join prop_analytics pa on pa.market_id = m.id
group by 1 order by 1;
\echo '=== Linhas no painel (v_props_board) ==='
select sport_id, count(*) from v_props_board group by 1 order by 1;
\echo '=== Agendamentos pg_cron ==='
select jobname, schedule from cron.job order by 1;
\echo '=== Estatísticas de TIME por esporte/liga ==='
select t.sport_id, coalesce(g.external_ids ->> 'espn_path', t.sport_id) as liga, count(*) as linhas,
       string_agg(distinct k, ', ') as chaves
from team_game_stats t join games g on g.id = t.game_id
cross join lateral jsonb_object_keys(t.stats) k
group by 1, 2 order by 1, 2;
\echo '=== Mercados de time analisados (próximas 72h) ==='
select g.sport_id, a.subject, count(*) as mercados, round(avg(a.score)) as score_medio,
       count(*) filter (where a.score >= 70) as score_70
from team_market_analytics a join games g on g.id = a.game_id
where g.start_time > now() group by 1, 2 order by 1, 2;
\echo '=== Picks do dia ==='
select status, count(*) from team_picks group by 1;
