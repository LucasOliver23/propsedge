"""Contratos comuns: todo provedor devolve objetos normalizados; os jobs só conhecem estes tipos."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol


@dataclass
class NGame:
    ext_id: str
    sport_id: str
    start_time: datetime
    home_name: str
    home_abbr: str | None
    home_ext: str
    away_name: str
    away_abbr: str | None
    away_ext: str
    status: str                  # scheduled | live | final | postponed | cancelled
    period: str | None = None
    clock: str | None = None
    home_score: int | None = None
    away_score: int | None = None
    meta: dict = field(default_factory=dict)   # extras salvos em games.external_ids (ex.: liga ESPN)
    home_logo: str | None = None
    away_logo: str | None = None


@dataclass
class NPlayerLine:
    player_ext: str
    player_name: str
    team_ext: str
    position: str | None
    minutes: float | None
    dnp: bool
    stats: dict[str, float] = field(default_factory=dict)
    headshot: str | None = None


@dataclass
class NTeamLine:
    team_ext: str
    stats: dict[str, float] = field(default_factory=dict)   # inclui parciais: goals_1h, points_q1, runs_f5...


@dataclass
class NBoxScore:
    game: NGame
    players: list[NPlayerLine]
    complete: bool               # True quando o provedor marca o jogo como encerrado/oficial
    teams: list[NTeamLine] = field(default_factory=list)


@dataclass
class NOdds:
    player_name: str
    stat_key: str
    bookmaker: str
    line: float
    over: float | None
    under: float | None


class StatsProvider(Protocol):
    ext_key: str
    def schedule(self, sport_id: str, days_ahead: int = 2, days_back: int = 1) -> list[NGame]: ...
    def boxscore(self, sport_id: str, game_ext_id: str, meta: dict | None = None) -> NBoxScore | None: ...
