"""
Provedor de agenda + box score via endpoints JSON públicos do ESPN (NBA, WNBA, NCAAB, NFL, MLB, NHL, Futebol).

⚠️ API não oficial: ótima para MVP/validação, sem SLA. Para produção paga, troque por
Sportradar / SportsDataIO implementando o mesmo contrato `StatsProvider` (providers/base.py).
Valide os nomes de `keys` de cada esporte com um jogo real antes de ligar em produção.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import httpx

from config import COMBOS, SPORTS
from providers.base import NBoxScore, NGame, NPlayerLine

BASE = "https://site.web.api.espn.com/apis/site/v2/sports"

# (grupo, chave ESPN) ou chave ESPN -> chave canônica (stat_types.key)
KEY_MAP: dict[str, dict] = {
    "basketball": {
        "points": "points", "rebounds": "rebounds", "assists": "assists", "steals": "steals",
        "blocks": "blocks", "turnovers": "turnovers", "threePointFieldGoalsMade": "threes",
    },
    "nfl": {
        ("passing", "passingYards"): "pass_yds", ("rushing", "rushingYards"): "rush_yds",
        ("receiving", "receivingYards"): "rec_yds", ("receiving", "receptions"): "receptions",
    },
    "mlb": {("batting", "hits"): "hits", ("pitching", "strikeouts"): "strikeouts"},
    "nhl": {"goals": "goals", "assists": "assists", "shotsTotal": "shots", "shots": "shots"},
    "soccer": {"totalGoals": "goals", "shotsOnTarget": "shots_on_target", "totalShots": "shots"},
}
FAMILY = {"nba": "basketball", "wnba": "basketball", "ncaab": "basketball",
          "nfl": "nfl", "mlb": "mlb", "nhl": "nhl", "soccer": "soccer"}
EXTRA_COMBOS = {"nhl": {"points": ("goals", "assists")}}


def _num(v) -> float | None:
    try:
        return float(str(v).replace("+", ""))
    except (TypeError, ValueError):
        return None


def _minutes(v) -> float | None:
    if v is None:
        return None
    s = str(v)
    if ":" in s:  # NHL "18:32"
        m, sec = s.split(":", 1)
        return round(int(m) + int(sec) / 60, 2)
    return _num(s)


def _status(comp_status: dict) -> str:
    t = comp_status.get("type", {})
    name = t.get("name", "")
    if "POSTPONED" in name:
        return "postponed"
    if "CANCELED" in name or "CANCELLED" in name:
        return "cancelled"
    return {"pre": "scheduled", "in": "live", "post": "final"}.get(t.get("state"), "scheduled")


class ESPNProvider:
    ext_key = "espn"

    def __init__(self) -> None:
                self.http = httpx.Client(timeout=20, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36", "Referer": "https://www.espn.com/"})

    # ------------------------------------------------------------------ agenda
    def _parse_event(self, sport_id: str, ev: dict, path: str) -> NGame:
        comp = ev["competitions"][0]
        home = next(c for c in comp["competitors"] if c["homeAway"] == "home")
        away = next(c for c in comp["competitors"] if c["homeAway"] == "away")
        st = comp.get("status") or ev.get("status", {})

        def score(c: dict) -> int | None:
            v = c.get("score")
            if isinstance(v, dict):          # alguns endpoints mandam {"value": 3, "displayValue": "3"}
                v = v.get("value")
            n = _num(v)
            return int(n) if n is not None else None

        return NGame(
            ext_id=str(ev["id"]), sport_id=sport_id,
            start_time=datetime.fromisoformat(ev["date"].replace("Z", "+00:00")),
            home_name=home["team"]["displayName"], home_abbr=home["team"].get("abbreviation"),
            home_ext=str(home["team"]["id"]),
            away_name=away["team"]["displayName"], away_abbr=away["team"].get("abbreviation"),
            away_ext=str(away["team"]["id"]),
            status=_status(st), period=str(st.get("period") or "") or None, clock=st.get("displayClock"),
            home_score=score(home), away_score=score(away),
            meta={"espn_path": path},
        )

    def schedule(self, sport_id: str, days_ahead: int = 2, days_back: int = 1) -> list[NGame]:
        out: list[NGame] = []
        today = datetime.now(timezone.utc).date()
        for path in SPORTS[sport_id].espn_paths:
            for d in range(-days_back, days_ahead + 1):
                day = (today + timedelta(days=d)).strftime("%Y%m%d")
                r = self.http.get(f"{BASE}/{path}/scoreboard", params={"dates": day, "limit": 300})
                if r.status_code >= 400:
                    continue
                for ev in r.json().get("events", []):
                    try:
                        out.append(self._parse_event(sport_id, ev, path))
                    except (KeyError, StopIteration, ValueError):
                        continue  # evento sem os dois participantes definidos (ex.: "a definir")
        return out

    # --------------------------------------------------------------- box score
    def boxscore(self, sport_id: str, game_ext_id: str, meta: dict | None = None) -> NBoxScore | None:
        path = (meta or {}).get("espn_path") or SPORTS[sport_id].espn_paths[0]
        r = self.http.get(f"{BASE}/{path}/summary", params={"event": game_ext_id})
        if r.status_code == 404:
            return None
        r.raise_for_status()
        data = r.json()
        header_comp = data["header"]["competitions"][0]
        ev = {"id": game_ext_id, "date": header_comp["date"], "competitions": [header_comp]}
        game = self._parse_event(sport_id, ev, path)

        family = FAMILY[sport_id]
        players: dict[str, NPlayerLine] = {}
        if "rosters" in data:          # futebol
            self._parse_rosters(data["rosters"], family, players)
        for team_block in data.get("boxscore", {}).get("players", []):
            self._parse_team_block(team_block, family, players)

        combos = {**COMBOS.get(sport_id, {}), **EXTRA_COMBOS.get(sport_id, {})}
        for pl in players.values():
            for combo, parts in combos.items():
                if all(p in pl.stats for p in parts):
                    pl.stats[combo] = sum(pl.stats[p] for p in parts)

        complete = header_comp.get("status", {}).get("type", {}).get("completed", False)
        return NBoxScore(game=game, players=list(players.values()), complete=bool(complete))

    def _parse_team_block(self, block: dict, family: str, players: dict[str, NPlayerLine]) -> None:
        team_ext = str(block["team"]["id"])
        kmap = KEY_MAP[family]
        for group in block.get("statistics", []):
            gname = (group.get("name") or group.get("type") or "").lower()
            keys = group.get("keys") or []
            for a in group.get("athletes", []):
                ath = a["athlete"]
                pid = str(ath["id"])
                pl = players.setdefault(pid, NPlayerLine(
                    player_ext=pid, player_name=ath["displayName"], team_ext=team_ext,
                    position=(ath.get("position") or {}).get("abbreviation"),
                    minutes=None, dnp=bool(a.get("didNotPlay")),
                    headshot=(ath.get("headshot") or {}).get("href"),
                ))
                for k, raw in zip(keys, a.get("stats") or []):
                    if k in ("minutes", "timeOnIce"):
                        pl.minutes = _minutes(raw)
                        continue
                    # "made-attempted" -> duas chaves
                    subkeys, subvals = (k.split("-"), str(raw).split("-")) if "-" in k else ([k], [raw])
                    for sk, sv in zip(subkeys, subvals):
                        canon = kmap.get((gname, sk)) or kmap.get(sk)
                        val = _num(sv)
                        if canon and val is not None:
                            pl.stats[canon] = val
                if pl.minutes == 0:
                    pl.dnp = True

    def _parse_rosters(self, rosters: list, family: str, players: dict[str, NPlayerLine]) -> None:
        kmap = KEY_MAP[family]
        for team in rosters:
            team_ext = str(team["team"]["id"])
            for entry in team.get("roster", []):
                ath = entry["athlete"]
                stats = {kmap[s["name"]]: _num(s.get("value")) or 0.0
                         for s in entry.get("stats", []) if s.get("name") in kmap}
                played = entry.get("starter") or entry.get("subbedIn")
                players[str(ath["id"])] = NPlayerLine(
                    player_ext=str(ath["id"]), player_name=ath["displayName"], team_ext=team_ext,
                    position=(entry.get("position") or {}).get("abbreviation"),
                    minutes=None, dnp=not played, stats=stats,
                )
