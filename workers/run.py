"""CLI única para os jobs.

    python run.py backfill   --days 30        # histórico inicial (L5/L10/L20, H2H, DvP)
    python run.py schedule                    # agenda hoje-1 .. hoje+2
    python run.py odds                        # odds de props (The Odds API)
    python run.py boxscores                   # placar/stats ao vivo + finalização (Auto Green/Red)
    python run.py analytics                   # motor de confiança + EV
    python run.py pipeline                    # odds -> analytics (cron de 30 min)
    python run.py dvp                         # recalcula DvP
    python run.py live                        # processo contínuo (Fly.io)
    python run.py setup      --days 30        # tudo acima em ordem (primeira carga)

    --sports nba,mlb   limita os esportes (padrão: todos)
"""
from __future__ import annotations

import argparse
import logging
import sys

from config import ODDS_API_KEY, SPORTS

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", stream=sys.stdout)
log = logging.getLogger("propsedge")


def _dvp() -> None:
    from db import connect
    with connect() as conn:
        conn.execute("select refresh_dvp()")
        conn.commit()
    log.info("DvP recalculado")


def _odds(sports: list[str]) -> None:
    if not ODDS_API_KEY:
        log.warning("ODDS_API_KEY não configurada — pulando odds")
        return
    from jobs import sync_odds
    sync_odds.run(sports)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("job", choices=["backfill", "schedule", "odds", "boxscores", "analytics",
                                    "pipeline", "dvp", "live", "setup"])
    ap.add_argument("--sports", default=",".join(SPORTS))
    ap.add_argument("--days", type=int, default=30)
    args = ap.parse_args()
    sports = [s.strip() for s in args.sports.split(",") if s.strip() in SPORTS]

    from jobs import backfill, compute_analytics, live_worker, sync_boxscores, sync_schedule

    job = args.job
    if job == "backfill":
        backfill.run(sports, args.days)
    elif job == "schedule":
        sync_schedule.run(sports)
    elif job == "odds":
        _odds(sports)
    elif job == "boxscores":
        sync_boxscores.run(sports)
    elif job == "analytics":
        compute_analytics.run()
    elif job == "pipeline":
        _odds(sports)
        compute_analytics.run()
    elif job == "dvp":
        _dvp()
    elif job == "live":
        live_worker.run()
    elif job == "setup":
        backfill.run(sports, args.days)
        sync_schedule.run(sports)
        _dvp()
        _odds(sports)
        compute_analytics.run()


if __name__ == "__main__":
    main()
