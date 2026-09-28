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
from providers.base import NBoxScore, NGame, NPlayerLine, NTeamLine

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

# Estatísticas de TIME: nome ESPN (ou "grupo.nome") -> chave canônica (team_market_types.key)
TEAM_MAP: dict[str, dict[str, str]] = {
    "soccer": {
        "wonCorners": "corners", "foulsCommitted": "fouls", "totalShots": "shots",
        "shotsOnTarget": "shots_on_target", "yellowCards": "yellow_cards", "redCards": "red_cards",
        "offsides": "offsides", "saves": "saves", "possessionPct": "possession",
        "throwIns": "throw_ins", "totalThrowIns": "throw_ins", "throws": "throw_ins",
        "totalPasses": "passes", "totalCrosses": "crosses", "totalTackles": "tackles",
    },
    "basketball": {
        "totalRebounds": "rebounds", "rebounds": "rebounds", "assists": "assists",
        "threePointFieldGoalsMade": "threes", "turnovers": "turnovers", "totalTurnovers": "turnovers",
        "steals": "steals", "blocks": "blocks",
    },
    "nfl": {
        "totalYards": "total_yards", "netPassingYards": "pass_yds", "rushingYards": "rush_yds",
        "turnovers": "turnovers", "firstDowns": "first_downs",
    },
    "mlb": {"batting.hits": "hits", "hits": "hits", "batting.homeRuns": "home_runs", "errors": "errors"},
    "nhl": {"shotsTotal": "shots", "shots": "shots", "hits": "hits", "powerPlayGoals": "pp_goals"},
}
# chave do placar final e parciais por família: (chave, índices de períodos somados)
SCORE_KEY = {"soccer": "goals", "basketball": "points", "nfl": "points", "mlb": "runs", "nhl": "goals"}
PERIOD_KEYS = {
    "soccer": {"goals_1h": [0], "goals_2h": [1]},
    "basketball": {"points_q1": [0], "points_1h": [0, 1]},
    "nfl": {"points_1h": [0, 1]},
    "mlb": {"runs_f5": [0, 1, 2, 3, 4]},
    "nhl": {"goals_p1": [0]},
}


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
            home_logo=home["team"].get("logo") or ((home["team"].get("logos") or [{}])[0].get("href")),
            away_logo=away["team"].get("logo") or ((away["team"].get("logos") or [{}])[0].get("href")),
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

        teams = self._parse_team_stats(data, header_comp, family)
        complete = header_comp.get("status", {}).get("type", {}).get("completed", False)
        return NBoxScore(game=game, players=list(players.values()), complete=bool(complete), teams=teams)

    # ------------------------------------------------------- estatística de time
    def _parse_team_stats(self, data: dict, header_comp: dict, family: str) -> list[NTeamLine]:
        tmap = TEAM_MAP.get(family, {})
        out: dict[str, NTeamLine] = {}

        def flat(stats: list, prefix: str = "") -> dict[str, float]:
            res: dict[str, float] = {}
            for s in stats or []:
                if isinstance(s.get("stats"), list):      # MLB agrupa (batting/pitching)
                    res.update(flat(s["stats"], f"{(s.get('name') or '').lower()}."))
                    continue
                name = s.get("name")
                raw = s.get("displayValue", s.get("value"))
                if not name or raw is None:
                    continue
                if "-" in name and isinstance(raw, str) and "-" in raw:   # "made-attempted"
                    for sk, sv in zip(name.split("-"), raw.split("-")):
                        v = _num(sv)
                        if v is not None:
                            res[prefix + sk] = v
                    continue
                v = _num(str(raw).replace("%", ""))
                if v is not None:
                    res[prefix + name] = v
            return res

        for block in data.get("boxscore", {}).get("teams", []):
            ext = str(block.get("team", {}).get("id"))
            raw = flat(block.get("statistics", []))
            stats: dict[str, float] = {}
            for k, v in raw.items():
                canon = tmap.get(k) or tmap.get(k.split(".", 1)[-1])
                if canon and canon not in stats:
                    stats[canon] = v
            out[ext] = NTeamLine(team_ext=ext, stats=stats)

        # placar final e parciais (linescores)
        for c in header_comp.get("competitors", []):
            ext = str(c.get("team", {}).get("id"))
            line = out.setdefault(ext, NTeamLine(team_ext=ext))
            sc = c.get("score")
            if isinstance(sc, dict):
                sc = sc.get("value")
            if _num(sc) is not None:
                line.stats[SCORE_KEY[family]] = _num(sc)
            periods = [_num((ls or {}).get("displayValue", (ls or {}).get("value"))) for ls in c.get("linescores") or []]
            for key, idxs in PERIOD_KEYS.get(family, {}).items():
                if periods and max(idxs) < len(periods) and all(periods[i] is not None for i in idxs):
                    line.stats[key] = sum(periods[i] for i in idxs)

        if family == "soccer":
            for line in out.values():
                if "yellow_cards" in line.stats or "red_cards" in line.stats:
                    line.stats["cards"] = line.stats.get("yellow_cards", 0) + line.stats.get("red_cards", 0)
        return [t for t in out.values() if t.stats]

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

    # ------------------------------------------------------ classificação (tabela)
    def standings(self, sport_id: str) -> list[dict]:
        """Uma linha por time e liga: {league, team_ext, group, rank, played, wins, draws, losses, gf, ga, points}.
        Endpoint: /apis/v2/sports/{path}/standings (mesmo host web do ESPN)."""
        out: list[dict] = []
        base = BASE.replace("/apis/site/v2/sports", "/apis/v2/sports")
        for path in SPORTS[sport_id].espn_paths:
            try:
                r = self.http.get(f"{base}/{path}/standings")
                if r.status_code >= 400:
                    continue
                data = r.json()
            except Exception:
                continue
            out.extend(parse_standings(data, path))
        return out

    # ------------------------------------------- contexto pré-jogo (desfalques etc.)
    def game_context(self, sport_id: str, game_ext_id: str, meta: dict | None = None) -> dict:
        """Lê o summary do jogo ANTES de começar: desfalques (injuries), arremessador provável (MLB)
        e escalação confirmada (futebol, quando sai ~1h antes)."""
        path = (meta or {}).get("espn_path") or SPORTS[sport_id].espn_paths[0]
        r = self.http.get(f"{BASE}/{path}/summary", params={"event": game_ext_id})
        if r.status_code >= 400:
            return {"injuries": [], "lineups": []}
        return parse_context(r.json())


def _stat_map(entry: dict) -> dict[str, float]:
    res: dict[str, float] = {}
    for s in entry.get("stats") or []:
        name = s.get("name") or s.get("type")
        v = s.get("value")
        if v is None:
            v = _num(s.get("displayValue"))
        if name and isinstance(v, (int, float)):
            res[name] = float(v)
    return res


def parse_standings(data: dict, league: str) -> list[dict]:
    """Percorre children/standings recursivamente (liga única, conferências, divisões, grupos)."""
    rows: list[dict] = []

    def walk(node: dict, group: str | None) -> None:
        entries = (node.get("standings") or {}).get("entries") or []
        if entries:
            block = []
            for i, e in enumerate(entries):
                team = e.get("team") or {}
                if not team.get("id"):
                    continue
                st = _stat_map(e)
                block.append({
                    "league": league, "team_ext": str(team["id"]), "group": group,
                    "rank_raw": st.get("rank") or st.get("playoffSeed") or 0, "order": i,
                    "played": int(st.get("gamesPlayed", 0)), "wins": int(st.get("wins", 0)),
                    "draws": int(st.get("ties", 0)), "losses": int(st.get("losses", 0)),
                    "gf": st.get("pointsFor"), "ga": st.get("pointsAgainst"),
                    "points": st.get("points") if "points" in st else st.get("wins"),
                })
            # posição: 'rank' do ESPN quando existe; senão ordena por pontos/vitórias
            if all(b["rank_raw"] > 0 for b in block):
                for b in block:
                    b["rank"] = int(b["rank_raw"])
            else:
                block.sort(key=lambda b: (-(b["points"] or 0), -b["wins"], b["order"]))
                for i, b in enumerate(block, 1):
                    b["rank"] = i
            for b in block:
                b.pop("rank_raw"); b.pop("order")
            rows.extend(block)
        for child in node.get("children") or []:
            walk(child, child.get("name") or group)

    walk(data, None)
    return rows


OUT_WORDS = ("out", "injured reserve", "-il", " il", "suspen", "doubtful")


def injury_level(status: str) -> str:
    """Out/IL/IR/suspenso -> 'out'; Questionable/Day-To-Day -> 'questionable'."""
    s = (status or "").lower()
    if any(w in s for w in OUT_WORDS) or s.endswith("il"):
        return "out"
    return "questionable"


def parse_context(data: dict) -> dict:
    injuries, lineups = [], []
    for team_block in data.get("injuries") or []:
        team_ext = str((team_block.get("team") or {}).get("id") or "")
        for inj in team_block.get("injuries") or []:
            ath = inj.get("athlete") or {}
            if not ath.get("id"):
                continue
            det = inj.get("details") or {}
            detail = " ".join(x for x in (det.get("type"), det.get("detail")) if x) or None
            injuries.append({
                "athlete_ext": str(ath["id"]), "team_ext": team_ext, "name": ath.get("displayName") or "",
                "position": (ath.get("position") or {}).get("abbreviation"),
                "status": inj.get("status") or (inj.get("type") or {}).get("description") or "Out",
                "detail": detail, "return_date": det.get("returnDate"),
            })
    comp = ((data.get("header") or {}).get("competitions") or [{}])[0]
    for c in comp.get("competitors") or []:
        team_ext = str((c.get("team") or {}).get("id") or "")
        for p in c.get("probables") or []:
            ath = p.get("athlete") or {}
            if ath.get("id") and "pitcher" in (p.get("name") or "").lower():
                lineups.append({"athlete_ext": str(ath["id"]), "team_ext": team_ext,
                                "name": ath.get("displayName"), "role": "probable_pitcher"})
    for team in data.get("rosters") or []:
        team_ext = str((team.get("team") or {}).get("id") or "")
        for entry in team.get("roster") or []:
            ath = entry.get("athlete") or {}
            if entry.get("starter") and ath.get("id"):
                lineups.append({"athlete_ext": str(ath["id"]), "team_ext": team_ext,
                                "name": ath.get("displayName"), "role": "starter"})
    return {"injuries": injuries, "lineups": lineups}
