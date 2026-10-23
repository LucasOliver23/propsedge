"""
API-Football (api-sports.io) — fonte PAGA opcional para schedule/boxscore de futebol.

Por padrão o PropsEdge usa só a ESPN (grátis) pra futebol — ver providers/espn.py.
Esse provedor fica pronto aqui mas só é escolhido por `jobs.common.provider_for`
quando as duas variáveis de ambiente abaixo estiverem setadas:

    API_FOOTBALL_KEY=<sua chave de api-sports.io>
    USE_API_FOOTBALL=true

Mesmo com ele ligado, o contexto pré-jogo (lesões, escalação confirmada,
classificação — jobs/sync_context.py) continua vindo da ESPN: são dados
gratuitos e já funcionando, não há motivo pra pagar por eles também.

Documentação: https://www.api-football.com/documentation-v3
Plano grátis: 100 requisições/dia — por isso o schedule() aqui é bem mais
seletivo que o da ESPN (só as ligas configuradas em config.API_FOOTBALL_LEAGUES,
uma chamada por liga/dia, não por dia x liga como a ESPN faz).

Status: scaffold funcional, mas testado só "no papel" (sem chave ativa ainda).
Antes de ligar USE_API_FOOTBALL=true em produção, rodar manualmente contra
um jogo conhecido e comparar os números com a ESPN.
"""
from __future__ import annotations

from datetime import datetime, timezone

import httpx

from config import API_FOOTBALL_KEY
from providers.base import NBoxScore, NGame, NPlayerLine, NTeamLine

BASE = "https://v3.football.api-sports.io"

# liga API-Football -> mesma liga que a gente já busca via ESPN (config.SPORTS["soccer"].espn_paths)
# IDs de https://www.api-football.com/documentation-v3#tag/Leagues/operation/get-leagues
LEAGUE_IDS: dict[str, int] = {
    "bra.1": 71, "bra.2": 72, "bra.copa_do_brazil": 73,
    "conmebol.libertadores": 13, "conmebol.sudamericana": 11,
    "eng.1": 39, "esp.1": 140, "ita.1": 135, "ger.1": 78, "fra.1": 61,
    "uefa.champions": 2, "uefa.europa": 3,
}

_STATUS = {
    "TBD": "scheduled", "NS": "scheduled", "PST": "postponed", "CANC": "cancelled",
    "1H": "live", "HT": "live", "2H": "live", "ET": "live", "P": "live", "LIVE": "live",
    "FT": "final", "AET": "final", "PEN": "final",
}


class ApiFootballProvider:
    """Implementa o mesmo contrato de ESPNProvider (schedule/boxscore) só pra futebol."""

    ext_key = "api_football"

    def __init__(self) -> None:
        if not API_FOOTBALL_KEY:
            raise RuntimeError("API_FOOTBALL_KEY não configurada — defina a env var pra usar esse provedor")
        self.http = httpx.Client(timeout=20, headers={"x-apisports-key": API_FOOTBALL_KEY})

    def _get(self, path: str, **params) -> list[dict]:
        r = self.http.get(f"{BASE}/{path}", params=params)
        r.raise_for_status()
        data = r.json()
        return data.get("response", [])

    def _parse_fixture(self, sport_id: str, fx: dict) -> NGame:
        f, teams, goals = fx["fixture"], fx["teams"], fx["goals"]
        return NGame(
            ext_id=str(f["id"]), sport_id=sport_id,
            start_time=datetime.fromisoformat(f["date"]),
            home_name=teams["home"]["name"], home_abbr=None, home_ext=str(teams["home"]["id"]),
            away_name=teams["away"]["name"], away_abbr=None, away_ext=str(teams["away"]["id"]),
            status=_STATUS.get(f["status"]["short"], "scheduled"),
            period=f["status"]["short"], clock=str(f["status"].get("elapsed") or "") or None,
            home_score=goals.get("home"), away_score=goals.get("away"),
            meta={"api_football_league": fx["league"]["id"]},
            home_logo=teams["home"].get("logo"), away_logo=teams["away"].get("logo"),
        )

    def schedule(self, sport_id: str, days_ahead: int = 2, days_back: int = 1) -> list[NGame]:
        """Uma chamada por liga configurada, trazendo os próximos jogos dela (economiza cota)."""
        out: list[NGame] = []
        season = datetime.now(timezone.utc).year
        for league_id in LEAGUE_IDS.values():
            try:
                fixtures = self._get("fixtures", league=league_id, season=season, next=20)
            except httpx.HTTPStatusError:
                continue
            for fx in fixtures:
                out.append(self._parse_fixture(sport_id, fx))
        return out

    def boxscore(self, sport_id: str, game_ext_id: str, meta: dict | None = None) -> NBoxScore | None:
        fixtures = self._get("fixtures", id=game_ext_id)
        if not fixtures:
            return None
        game = self._parse_fixture(sport_id, fixtures[0])
        complete = game.status == "final"

        players: list[NPlayerLine] = []
        teams: list[NTeamLine] = []
        for team_block in self._get("fixtures/players", fixture=game_ext_id):
            team_ext = str(team_block["team"]["id"])
            for p in team_block.get("players", []):
                stats = (p.get("statistics") or [{}])[0]
                games_ = stats.get("games", {}) or {}
                goals_ = stats.get("goals", {}) or {}
                shots_ = stats.get("shots", {}) or {}
                minutes = games_.get("minutes")
                players.append(NPlayerLine(
                    player_ext=str(p["player"]["id"]), player_name=p["player"]["name"],
                    team_ext=team_ext, position=games_.get("position"),
                    minutes=float(minutes) if minutes is not None else None,
                    dnp=minutes is None,
                    stats={
                        "goals": float(goals_.get("total") or 0),
                        "assists": float(goals_.get("assists") or 0),
                        "shots": float(shots_.get("total") or 0),
                        "shots_on_target": float(shots_.get("on") or 0),
                    },
                    headshot=p["player"].get("photo"),
                ))
        return NBoxScore(game=game, players=players, complete=complete, teams=teams)
