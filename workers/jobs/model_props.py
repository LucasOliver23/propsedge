"""Props de JOGADORES sem depender da The Odds API.

Para cada jogo das próximas 36h cria os mercados (prop_markets.source='model') dos jogadores que
realmente jogam: aparecem nos últimos jogos do time, têm média mínima na estatística e não estão
fora por lesão. O compute_analytics depois calcula a linha "de casa" pelo modelo (~50/50, odd ~1.85),
L5/L10/L20/H2H/DvP e a confiança. Quando a The Odds API trouxer a odd real, a linha passa a ser a da casa.

Não consome créditos: usa só o banco.
"""
from __future__ import annotations

from db import connect
from jobs.common import log

HORIZON_HOURS = 36
MIN_APPEARANCES = 5        # jogos com a estatística nos últimos 45 dias
MIN_APPEARANCES_BY_SPORT = {"nfl": 3, "soccer": 4}   # NFL é semanal; futebol tem menos jogos por mês
MAX_PER_TEAM_STAT = 8      # no máximo N jogadores por time e estatística (os de maior média)

# média mínima (L10) para o mercado fazer sentido — evita "Mais de 0.5 jardas" de reserva
MIN_MEAN: dict[tuple[str, str], float] = {
    ("mlb", "hits"): 0.6, ("mlb", "strikeouts"): 3.0,
    ("nfl", "pass_yds"): 120, ("nfl", "rush_yds"): 25, ("nfl", "rec_yds"): 25, ("nfl", "receptions"): 2,
    ("nhl", "shots"): 1.5, ("nhl", "points"): 0.35,
    ("soccer", "shots"): 0.8, ("soccer", "shots_on_target"): 0.4, ("soccer", "goals"): 0.2,
    ("nba", "points"): 8, ("nba", "rebounds"): 3, ("nba", "assists"): 2, ("nba", "pra"): 12, ("nba", "threes"): 1,
    ("wnba", "points"): 7, ("wnba", "rebounds"): 3, ("wnba", "assists"): 2,
    ("ncaab", "points"): 8, ("ncaab", "rebounds"): 3,
}
PITCHER_POS = ("SP", "RP", "P")

CANDIDATES_SQL = """
with g as (
  select id, sport_id, home_team_id, away_team_id, start_time
  from games
  where status = 'scheduled' and start_time between now() and now() + make_interval(hours => %(h)s)
    and sport_id = any(%(sports)s)
), t as (
  select id as game_id, sport_id, home_team_id as team_id from g
  union all
  select id, sport_id, away_team_id from g
), st as (
  select sport_id, key from stat_types
)
select t.game_id, t.sport_id, t.team_id, st.key as stat_key, s.player_id, p.position,
       count(*) as n, avg((s.stats ->> st.key)::numeric) as mean,
       max(s.game_date) as last_game,
       bool_or(lu.role = 'probable_pitcher') as probable,
       bool_or(lu.role = 'starter') as starter,
       bool_or(lu_any.game_id is not null) as lineup_known
from t
join st on st.sport_id = t.sport_id
join lateral (
  select x.player_id, x.stats, x.game_date
  from player_game_stats x
  where x.sport_id = t.sport_id and x.team_id = t.team_id and not x.dnp
    and x.game_date > current_date - 45 and x.stats ? st.key
) s on true
join players p on p.id = s.player_id and p.team_id = t.team_id and p.status <> 'out'
left join game_lineups lu on lu.game_id = t.game_id and lu.player_id = s.player_id
left join lateral (select game_id from game_lineups where game_id = t.game_id and team_id = t.team_id
                   and role = 'starter' limit 1) lu_any on true
group by t.game_id, t.sport_id, t.team_id, st.key, s.player_id, p.position
having count(*) >= %(min_n)s and max(s.game_date) > current_date - 15
"""


def _keep(r: dict) -> bool:
    sport, key, pos = r["sport_id"], r["stat_key"], (r["position"] or "").upper()
    if r["n"] < MIN_APPEARANCES_BY_SPORT.get(sport, MIN_APPEARANCES):
        return False
    if float(r["mean"] or 0) < MIN_MEAN.get((sport, key), 0.3):
        return False
    if sport == "mlb":
        if key == "strikeouts":
            return bool(r["probable"])          # só o arremessador provável do dia
        if key == "hits" and pos in PITCHER_POS:
            return False
    if sport in ("soccer", "mlb") and r["lineup_known"] and key != "strikeouts":
        return bool(r["starter"])               # escalação saiu: só titulares
    return True


def run(sports: list[str] | None = None) -> int:
    with connect() as conn, conn.cursor() as cur:
        if sports is None:
            cur.execute("select id from sports")
            sports = [r["id"] for r in cur.fetchall()]
        cur.execute(CANDIDATES_SQL, {"h": HORIZON_HOURS, "sports": sports, "min_n": min(MIN_APPEARANCES_BY_SPORT.values())})
        rows = [r for r in cur.fetchall() if _keep(r)]

        # limita por time/estatística aos de maior média
        rows.sort(key=lambda r: (r["game_id"], r["team_id"], r["stat_key"], -float(r["mean"])))
        picked, seen = [], {}
        for r in rows:
            k = (r["game_id"], r["team_id"], r["stat_key"])
            seen[k] = seen.get(k, 0) + 1
            if seen[k] <= MAX_PER_TEAM_STAT:
                picked.append((r["game_id"], r["player_id"], r["sport_id"], r["stat_key"]))

        cur.executemany(
            """insert into prop_markets (game_id, player_id, sport_id, stat_key, source)
               values (%s,%s,%s,%s,'model') on conflict (game_id, player_id, stat_key) do nothing""",
            picked,
        )
        conn.commit()
    log.info("props do modelo: %d mercados de jogadores garantidos (sem gastar créditos)", len(picked))
    return len(picked)
