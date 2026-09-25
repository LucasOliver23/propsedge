"""
Odds de player props via The Odds API (https://the-odds-api.com) — v4.

Custo: cada chamada /events/{id}/odds consome (nº de mercados x nº de regiões) créditos.
Por isso o job filtra só jogos das próximas ~36h e só os mercados de stat_types.
"""
from __future__ import annotations

from datetime import datetime

import httpx

from config import BOOKMAKERS, ODDS_API_KEY, ODDS_REGIONS
from providers.base import NOdds

BASE = "https://api.the-odds-api.com/v4"


class OddsAPI:
    def __init__(self) -> None:
        if not ODDS_API_KEY:
            raise RuntimeError("ODDS_API_KEY não configurada")
        self.http = httpx.Client(timeout=30)
        self.remaining: int | None = None
        self.book_titles: dict[str, str] = {}   # key -> nome (para cadastrar casas novas)

    def _get(self, url: str, **params) -> list | dict:
        r = self.http.get(url, params={"apiKey": ODDS_API_KEY, **params})
        r.raise_for_status()
        rem = r.headers.get("x-requests-remaining")
        if rem is not None:
            self.remaining = int(float(rem))
        return r.json()

    def events(self, sport_key: str) -> list[dict]:
        """[{id, commence_time, home_team, away_team}]"""
        return self._get(f"{BASE}/sports/{sport_key}/events")  # type: ignore[return-value]

    def props(self, sport_key: str, event_id: str, market_to_stat: dict[str, str]) -> list[NOdds]:
        params = {"regions": ODDS_REGIONS, "markets": ",".join(market_to_stat), "oddsFormat": "decimal"}
        if BOOKMAKERS:
            params["bookmakers"] = BOOKMAKERS
        data = self._get(f"{BASE}/sports/{sport_key}/events/{event_id}/odds", **params)
        # agrupa Over/Under do mesmo jogador+linha
        acc: dict[tuple[str, str, str, float], NOdds] = {}
        for bk in data.get("bookmakers", []):  # type: ignore[union-attr]
            self.book_titles[bk["key"]] = bk.get("title", bk["key"])
            for mk in bk.get("markets", []):
                stat = market_to_stat.get(mk["key"])
                if not stat:
                    continue
                for o in mk.get("outcomes", []):
                    player = o.get("description")
                    if not player:
                        continue
                    line = float(o.get("point", 0.5))           # "Yes/No" (marcar gol) => 0.5
                    key = (bk["key"], player, stat, line)
                    rec = acc.setdefault(key, NOdds(player, stat, bk["key"], line, None, None))
                    if o["name"] in ("Over", "Yes"):
                        rec.over = float(o["price"])
                    elif o["name"] in ("Under", "No"):
                        rec.under = float(o["price"])

        # linha principal por casa = a que tem os dois lados mais equilibrados
        best: dict[tuple[str, str, str], NOdds] = {}
        for rec in acc.values():
            k = (rec.bookmaker, rec.player_name, rec.stat_key)
            cur = best.get(k)
            if cur is None or _balance(rec) < _balance(cur):
                best[k] = rec
        return list(best.values())


def _balance(o: NOdds) -> float:
    if o.over and o.under:
        return abs(o.over - o.under)
    return 99.0


def parse_time(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))
