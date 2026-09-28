"""Testes das funções novas: contexto ESPN, Poisson 1X2/ambas marcam, pressão ao vivo, linha do modelo."""
import math
import sys
import types

# o ambiente de teste não precisa de banco: stubs leves de psycopg/dotenv
for name in ("psycopg", "psycopg.rows", "dotenv"):
    if name not in sys.modules:
        try:
            __import__(name)
        except ImportError:
            m = types.ModuleType(name)
            m.connect = lambda *a, **k: None
            m.dict_row = None
            m.load_dotenv = lambda *a, **k: None
            m.types = types.SimpleNamespace(json=types.SimpleNamespace(Jsonb=lambda x: x))
            sys.modules[name] = m

from engine.team_score import btts_mu, poisson_match, proj_prob  # noqa: E402
from providers.espn import injury_level, parse_context, parse_standings  # noqa: E402


def test_poisson_match_sums_and_btts():
    pm = poisson_match(1.6, 1.1)
    assert abs(pm["home"] + pm["draw"] + pm["away"] - 1) < 1e-9
    assert pm["home"] > pm["away"] and 0.2 < pm["draw"] < 0.3
    assert abs(pm["btts"] - (1 - math.exp(-1.6)) * (1 - math.exp(-1.1))) < 1e-9
    assert pm["over15"] > pm["over25"]


def test_btts_mu_roundtrip():
    for p in (0.35, 0.5, 0.62):
        assert abs(proj_prob(btts_mu(p), 0.5, 0.5, "over") - p) < 1e-6


def test_parse_standings_rank_and_fallback():
    soccer = {"children": [{"name": "2026 Serie B", "standings": {"entries": [
        {"team": {"id": "9973"}, "stats": [{"name": "rank", "value": 1}, {"name": "points", "value": 54},
                                           {"name": "gamesPlayed", "value": 30}, {"name": "wins", "value": 16},
                                           {"name": "ties", "value": 6}, {"name": "losses", "value": 8},
                                           {"name": "pointsFor", "value": 43}, {"name": "pointsAgainst", "value": 31}]},
    ]}}]}
    r = parse_standings(soccer, "soccer/bra.2")[0]
    assert r["rank"] == 1 and r["draws"] == 6 and r["gf"] == 43 and r["group"] == "2026 Serie B"
    nhl = {"children": [{"name": "East", "standings": {"entries": [
        {"team": {"id": "1"}, "stats": [{"name": "points", "value": 10}, {"name": "wins", "value": 5}]},
        {"team": {"id": "2"}, "stats": [{"name": "points", "value": 14}, {"name": "wins", "value": 7}]},
    ]}}]}
    rows = {r["team_ext"]: r["rank"] for r in parse_standings(nhl, "hockey/nhl")}
    assert rows == {"2": 1, "1": 2}


def test_parse_context_injuries_probables_starters():
    data = {
        "injuries": [{"team": {"id": "15"}, "injuries": [
            {"status": "15-Day-IL", "athlete": {"id": "33860", "displayName": "R. Lopez", "position": {"abbreviation": "RP"}},
             "details": {"type": "Shoulder", "detail": "Inflammation", "returnDate": "2026-09-29"}},
            {"status": "Questionable", "athlete": {"id": "9", "displayName": "X"}}]}],
        "header": {"competitions": [{"competitors": [{"team": {"id": "15"}, "probables": [
            {"name": "probableStartingPitcher", "athlete": {"id": "30948", "displayName": "Chris Sale"}}]}]}]},
        "rosters": [{"team": {"id": "7"}, "roster": [{"starter": True, "athlete": {"id": "5", "displayName": "Y"}},
                                                      {"starter": False, "athlete": {"id": "6", "displayName": "Z"}}]}],
    }
    ctx = parse_context(data)
    assert len(ctx["injuries"]) == 2 and ctx["injuries"][0]["detail"] == "Shoulder Inflammation"
    roles = {(x["athlete_ext"], x["role"]) for x in ctx["lineups"]}
    assert roles == {("30948", "probable_pitcher"), ("5", "starter")}


def test_injury_level():
    assert injury_level("Out") == "out" and injury_level("15-Day-IL") == "out"
    assert injury_level("Injured Reserve") == "out" and injury_level("Questionable") == "questionable"
    assert injury_level("Day-To-Day") == "questionable"


def test_parse_minute():
    from jobs.common import parse_minute
    assert parse_minute("67'") == 67 and parse_minute("45'+2'") == 47 and parse_minute(None) is None
    assert parse_minute("67:12") == 67


def test_pressure_and_rules():
    from jobs.live_alerts import pressure, rules
    old = {"shots": 5, "shots_on_target": 1, "corners": 2}
    new = {"shots": 9, "shots_on_target": 3, "corners": 5}
    p, w = pressure(new, old, 70, 58)
    # delta: 2 no gol (6) + 2 fora (2) + 3 escanteios (4.5) = 12.5 pts em 12 min -> 10.4/10min -> 100
    assert w == 12 and p == 100.0
    p0, _ = pressure({"shots": 2, "shots_on_target": 0, "corners": 1}, None, 30, None)
    assert 0 < p0 < 30
    r = {x[0] for x in rules(65, 0, 1, 80, 20, "Casa", "Fora", 9, 9.5)}
    assert {"gol_maduro", "virada_home", "escanteios_ritmo"} <= r
    assert rules(20, 0, 0, 90, 90, "A", "B", 1, None) == []


def test_model_line_from_recent():
    from jobs.compute_analytics import model_line
    assert model_line([1, 2], None) is None
    line = model_line([22, 18, 25, 19, 21, 24, 17, 20], None)
    assert line in (19.5, 20.5, 21.5)
    assert model_line([0, 1, 0, 1, 1, 0, 2, 1], None) == 0.5


def test_model_props_keep_rules():
    from jobs.model_props import _keep
    base = {"sport_id": "mlb", "stat_key": "strikeouts", "position": "SP", "n": 8, "mean": 5.1,
            "probable": False, "starter": False, "lineup_known": False}
    assert not _keep(base) and _keep({**base, "probable": True})
    assert not _keep({**base, "stat_key": "hits", "position": "SP", "mean": 1.0})
    assert _keep({**base, "stat_key": "hits", "position": "SS", "mean": 1.0})
    soc = {"sport_id": "soccer", "stat_key": "shots", "position": "F", "n": 4, "mean": 2.0,
           "probable": False, "starter": False, "lineup_known": True}
    assert not _keep(soc) and _keep({**soc, "starter": True})
    assert not _keep({**soc, "sport_id": "nfl", "stat_key": "pass_yds", "mean": 40, "n": 3})


def test_mlb_official_parsers():
    from datetime import datetime, timezone
    from providers.mlb_official import parse_lineup, parse_schedule
    from jobs.mlb_context import _match
    sched = parse_schedule({"dates": [{"games": [{
        "gamePk": 822679, "gameDate": "2026-09-27T17:05:00Z", "status": {"abstractGameState": "Preview"},
        "teams": {"home": {"team": {"id": 120, "name": "Washington Nationals"},
                           "probablePitcher": {"id": 687792, "fullName": "DJ Herz"}},
                  "away": {"team": {"id": 121, "name": "New York Mets"}}}}]}]})
    g = sched[0]
    assert g["game_pk"] == 822679 and g["home_prob"] == {"id": "687792", "name": "DJ Herz"} and g["away_prob"] is None
    ours = {"start_time": datetime(2026, 9, 27, 18, 0, tzinfo=timezone.utc),
            "home": "Washington Nationals", "away": "New York Mets"}
    assert _match(ours, sched) is g
    box = {"teams": {"home": {"players": {
        "ID1": {"person": {"id": 1, "fullName": "A"}, "battingOrder": "200", "position": {"abbreviation": "SS"}},
        "ID2": {"person": {"id": 2, "fullName": "B"}, "battingOrder": "100"},
        "ID3": {"person": {"id": 3, "fullName": "C"}, "battingOrder": "101"},
        "ID4": {"person": {"id": 4, "fullName": "D"}}}}, "away": {"players": {}}}}
    lu = parse_lineup(box)
    assert [(p["name"], p["order"]) for p in lu["home"]] == [("B", 1), ("A", 2)] and lu["away"] == []
