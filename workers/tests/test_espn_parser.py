"""Testa o parser do ESPN com respostas no formato do endpoint /summary (sem rede)."""
import os

os.environ.setdefault("DATABASE_URL", "postgresql://x")

import httpx  # noqa: E402

from providers.espn import ESPNProvider  # noqa: E402

HEADER = {"competitions": [{
    "date": "2026-09-24T23:30Z",
    "status": {"period": 4, "displayClock": "0:00", "type": {"state": "post", "completed": True, "name": "STATUS_FINAL"}},
    "competitors": [
        {"homeAway": "home", "score": "112", "team": {"id": "13", "displayName": "Los Angeles Lakers", "abbreviation": "LAL"}},
        {"homeAway": "away", "score": "108", "team": {"id": "2", "displayName": "Boston Celtics", "abbreviation": "BOS"}},
    ],
}]}

NBA_SUMMARY = {
    "header": HEADER,
    "boxscore": {"players": [{
        "team": {"id": "13", "abbreviation": "LAL"},
        "statistics": [{
            "keys": ["minutes", "fieldGoalsMade-fieldGoalsAttempted", "threePointFieldGoalsMade-threePointFieldGoalsAttempted",
                     "rebounds", "assists", "points"],
            "athletes": [
                {"athlete": {"id": "1966", "displayName": "LeBron James", "position": {"abbreviation": "F"}},
                 "didNotPlay": False, "stats": ["36", "11-20", "3-7", "8", "9", "29"]},
                {"athlete": {"id": "99", "displayName": "Bench Guy", "position": {"abbreviation": "G"}},
                 "didNotPlay": True, "stats": []},
            ],
        }],
    }]},
}

SOCCER_SUMMARY = {
    "header": {"competitions": [{**HEADER["competitions"][0], "competitors": [
        {"homeAway": "home", "score": "2", "team": {"id": "819", "displayName": "Flamengo", "abbreviation": "FLA"}},
        {"homeAway": "away", "score": "1", "team": {"id": "2029", "displayName": "Palmeiras", "abbreviation": "PAL"}},
    ]}]},
    "rosters": [{"team": {"id": "819"}, "roster": [
        {"starter": True, "athlete": {"id": "1", "displayName": "Pedro"}, "position": {"abbreviation": "F"},
         "stats": [{"name": "totalGoals", "value": 1}, {"name": "shotsOnTarget", "value": 3}, {"name": "totalShots", "value": 5}]},
        {"starter": False, "subbedIn": False, "athlete": {"id": "2", "displayName": "Reserva"}, "stats": []},
    ]}],
}


def _provider(payload):
    p = ESPNProvider()
    p.http = httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(200, json=payload)))
    return p


def test_nba_boxscore():
    box = _provider(NBA_SUMMARY).boxscore("nba", "401", {"espn_path": "basketball/nba"})
    assert box.complete and box.game.status == "final" and box.game.home_score == 112
    lebron = next(p for p in box.players if p.player_name == "LeBron James")
    assert lebron.stats["points"] == 29 and lebron.stats["threes"] == 3 and lebron.stats["pra"] == 46
    assert lebron.minutes == 36 and not lebron.dnp
    assert next(p for p in box.players if p.player_name == "Bench Guy").dnp
    assert box.game.meta == {"espn_path": "basketball/nba"}


def test_soccer_rosters():
    box = _provider(SOCCER_SUMMARY).boxscore("soccer", "700", {"espn_path": "soccer/bra.1"})
    pedro = next(p for p in box.players if p.player_name == "Pedro")
    assert pedro.stats == {"goals": 1, "shots_on_target": 3, "shots": 5} and not pedro.dnp
    assert next(p for p in box.players if p.player_name == "Reserva").dnp


def test_schedule_parses_events():
    sb = {"events": [{"id": "401", "date": "2026-09-26T00:10Z", "competitions": HEADER["competitions"]}]}
    games = _provider(sb).schedule("mlb", days_ahead=0, days_back=0)
    assert len(games) == 1 and games[0].meta == {"espn_path": "baseball/mlb"}


SOCCER_TEAM_SUMMARY = {
    "header": {"competitions": [{**HEADER["competitions"][0], "competitors": [
        {"homeAway": "home", "score": "2", "linescores": [{"displayValue": "1"}, {"displayValue": "1"}],
         "team": {"id": "819", "displayName": "Criciuma", "abbreviation": "CRI", "logo": "https://x/cri.png"}},
        {"homeAway": "away", "score": "1", "linescores": [{"displayValue": "0"}, {"displayValue": "1"}],
         "team": {"id": "2029", "displayName": "Operario", "abbreviation": "OPE"}},
    ]}]},
    "boxscore": {"teams": [
        {"team": {"id": "819"}, "statistics": [{"name": "wonCorners", "displayValue": "6"},
                                               {"name": "foulsCommitted", "displayValue": "16"},
                                               {"name": "possessionPct", "displayValue": "55.4%"},
                                               {"name": "yellowCards", "displayValue": "2"},
                                               {"name": "redCards", "displayValue": "1"}]},
        {"team": {"id": "2029"}, "statistics": [{"name": "wonCorners", "displayValue": "3"}]},
    ]},
}

NBA_TEAM_SUMMARY = {
    "header": {"competitions": [{**HEADER["competitions"][0], "competitors": [
        {**HEADER["competitions"][0]["competitors"][0],
         "linescores": [{"value": 30}, {"value": 25}, {"value": 28}, {"value": 29}]},
        HEADER["competitions"][0]["competitors"][1],
    ]}]},
    "boxscore": {"teams": [{"team": {"id": "13"}, "statistics": [
        {"name": "threePointFieldGoalsMade-threePointFieldGoalsAttempted", "displayValue": "14-38"},
        {"name": "totalRebounds", "displayValue": "47"}]}]},
}


def test_soccer_team_stats_and_halves():
    box = _provider(SOCCER_TEAM_SUMMARY).boxscore("soccer", "700", {"espn_path": "soccer/bra.2"})
    t = {x.team_ext: x.stats for x in box.teams}
    assert t["819"]["corners"] == 6 and t["819"]["fouls"] == 16 and t["819"]["possession"] == 55.4
    assert t["819"]["goals"] == 2 and t["819"]["goals_1h"] == 1 and t["819"]["goals_2h"] == 1
    assert t["819"]["cards"] == 3
    assert t["2029"]["goals_1h"] == 0 and t["2029"]["corners"] == 3
    assert box.game.home_logo == "https://x/cri.png"


def test_nba_team_stats_quarters():
    box = _provider(NBA_TEAM_SUMMARY).boxscore("nba", "401", {"espn_path": "basketball/nba"})
    lal = next(x.stats for x in box.teams if x.team_ext == "13")
    assert lal["points"] == 112 and lal["points_q1"] == 30 and lal["points_1h"] == 55
    assert lal["threes"] == 14 and lal["rebounds"] == 47
