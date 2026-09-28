"""API oficial da MLB (statsapi.mlb.com) — grátis, sem chave.

Usada como COMPLEMENTO da ESPN (não substitui a agenda/box score):
  * arremessador provável de cada time (probablePitcher)
  * escalação confirmada com a ordem de rebatedores (sai ~3-4h antes do jogo)

⚠️ Os termos da MLB permitem uso pessoal/não comercial desses dados. Para o produto pago em escala,
   o caminho é um fornecedor licenciado (ver conversa sobre APIs). Se a fonte falhar, o job segue sem ela.
"""
from __future__ import annotations

from datetime import date, datetime

import httpx

BASE = "https://statsapi.mlb.com/api/v1"


class MLBOfficial:
    def __init__(self) -> None:
        self.http = httpx.Client(timeout=20, headers={"User-Agent": "PropsEdge/1.0"})

    def schedule(self, start: date, end: date) -> list[dict]:
        r = self.http.get(f"{BASE}/schedule", params={
            "sportId": 1, "startDate": start.isoformat(), "endDate": end.isoformat(), "hydrate": "probablePitcher"})
        r.raise_for_status()
        return parse_schedule(r.json())

    def lineup(self, game_pk: int) -> dict[str, list[dict]]:
        r = self.http.get(f"{BASE}/game/{game_pk}/boxscore")
        r.raise_for_status()
        return parse_lineup(r.json())


def parse_schedule(data: dict) -> list[dict]:
    out = []
    for d in data.get("dates") or []:
        for g in d.get("games") or []:
            teams = g.get("teams") or {}
            try:
                start = datetime.fromisoformat(g["gameDate"].replace("Z", "+00:00"))
            except (KeyError, ValueError):
                continue
            row = {"game_pk": g.get("gamePk"), "start": start,
                   "state": (g.get("status") or {}).get("abstractGameState")}
            for side in ("home", "away"):
                t = teams.get(side) or {}
                row[side] = (t.get("team") or {}).get("name") or ""
                pp = t.get("probablePitcher") or {}
                row[f"{side}_prob"] = {"id": str(pp["id"]), "name": pp.get("fullName") or ""} if pp.get("id") else None
            out.append(row)
    return out


def parse_lineup(box: dict) -> dict[str, list[dict]]:
    """Titulares = jogadores com battingOrder terminando em '00' (100 = 1º rebatedor, 200 = 2º...).
    Substitutos ficam com 101, 102... e são ignorados."""
    res: dict[str, list[dict]] = {"home": [], "away": []}
    for side in ("home", "away"):
        players = ((box.get("teams") or {}).get(side) or {}).get("players") or {}
        for p in players.values():
            bo = str(p.get("battingOrder") or "")
            if not bo.isdigit() or not bo.endswith("00"):
                continue
            person = p.get("person") or {}
            if not person.get("id"):
                continue
            res[side].append({"id": str(person["id"]), "name": person.get("fullName") or "",
                              "order": int(bo) // 100,
                              "position": (p.get("position") or {}).get("abbreviation")})
        res[side].sort(key=lambda x: x["order"])
    return res
