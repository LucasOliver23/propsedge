"""
Provedores para Tênis, CS2 e LoL.

Estes esportes não têm cobertura de props na The Odds API nem box score gratuito confiável,
então o contrato fica pronto e a implementação depende do plano contratado:

  * CS2 / LoL  -> PandaScore (agenda grátis; estatísticas por jogador exigem plano "Historical/Live")
                  endpoints: /csgo/matches/upcoming, /lol/matches/upcoming, /{game}/games/{id}
                  odds de props: OddsJam / OpticOdds / feed da própria casa.
  * Tênis      -> Sportradar Tennis v3 ou api-tennis.com (aces, duplas faltas, games por partida)

A agenda de esports via PandaScore já está implementada abaixo; o box score é o próximo passo.
"""
from __future__ import annotations

from datetime import datetime

import httpx

from config import PANDASCORE_TOKEN
from providers.base import NBoxScore, NGame

PS_GAME = {"cs2": "csgo", "lol": "lol"}


class PandaScoreProvider:
    ext_key = "pandascore"

    def __init__(self) -> None:
        if not PANDASCORE_TOKEN:
            raise NotImplementedError("PANDASCORE_TOKEN não configurado")
        self.http = httpx.Client(base_url="https://api.pandascore.co", timeout=20,
                                 headers={"Authorization": f"Bearer {PANDASCORE_TOKEN}"})

    def schedule(self, sport_id: str, days_ahead: int = 2, days_back: int = 1) -> list[NGame]:
        out: list[NGame] = []
        for endpoint in ("running", "upcoming"):
            r = self.http.get(f"/{PS_GAME[sport_id]}/matches/{endpoint}", params={"per_page": 100})
            r.raise_for_status()
            for m in r.json():
                opp = m.get("opponents") or []
                if len(opp) != 2 or not m.get("scheduled_at"):
                    continue
                a, b = opp[0]["opponent"], opp[1]["opponent"]
                results = {x["team_id"]: x["score"] for x in m.get("results", [])}
                out.append(NGame(
                    ext_id=str(m["id"]), sport_id=sport_id,
                    start_time=datetime.fromisoformat(m["scheduled_at"].replace("Z", "+00:00")),
                    home_name=a["name"], home_abbr=a.get("acronym"), home_ext=str(a["id"]),
                    away_name=b["name"], away_abbr=b.get("acronym"), away_ext=str(b["id"]),
                    status={"running": "live", "finished": "final", "canceled": "cancelled",
                            "postponed": "postponed"}.get(m.get("status"), "scheduled"),
                    home_score=results.get(a["id"]), away_score=results.get(b["id"]),
                ))
        return out

    def boxscore(self, sport_id: str, game_ext_id: str, meta: dict | None = None) -> NBoxScore | None:
        raise NotImplementedError("Requer plano de estatísticas da PandaScore — ver docstring do módulo")


class TennisProvider:
    ext_key = "tennis"

    def schedule(self, sport_id: str, days_ahead: int = 2, days_back: int = 1) -> list[NGame]:
        raise NotImplementedError("Conecte Sportradar Tennis v3 ou api-tennis.com")

    def boxscore(self, sport_id: str, game_ext_id: str, meta: dict | None = None) -> NBoxScore | None:
        raise NotImplementedError("Conecte Sportradar Tennis v3 ou api-tennis.com")
