"""Carga inicial de histórico (L5/L10/L20, H2H e DvP precisam de jogos passados).

    python run.py backfill --days 30              # esportes em temporada agora
    python run.py backfill --days 200 --sports nba  # temporada anterior inteira da NBA

Busca a agenda dos últimos N dias no ESPN e grava o box score de cada jogo encerrado.
É idempotente: pode rodar de novo sem duplicar nada.
"""
from __future__ import annotations

from config import SPORTS
from jobs import sync_boxscores, sync_schedule
from jobs.common import log


def run(sports: list[str], days: int = 30) -> None:
    espn_sports = [s for s in sports if SPORTS[s].stats_provider == "espn"]
    # a agenda por dia é barata; faz em blocos para não segurar conexão por muito tempo
    step = 15
    for start in range(0, days, step):
        back = min(days, start + step)
        log.info("backfill: agenda de %d a %d dias atrás", start, back)
        sync_schedule.run(espn_sports, days_ahead=-start if start else 2, days_back=back)
    counts = sync_boxscores.run(espn_sports, days=days + 1, limit=20000, workers=8)
    log.info("backfill concluído: %s", counts)
