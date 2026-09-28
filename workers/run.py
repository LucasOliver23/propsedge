"""CLI única para os jobs.

    python run.py backfill   --days 30        # histórico inicial (L5/L10/L20, H2H, DvP)
    python run.py schedule                    # agenda hoje-1 .. hoje+2 + classificação/desfalques
    python run.py context                     # só classificação, desfalques, prováveis e escalações
    python run.py model_props                 # props de jogadores com linha do modelo (sem créditos)
    python run.py live_alerts                 # pressão ao vivo + alertas (futebol)
    python run.py odds                        # odds de props (The Odds API)
    python run.py boxscores                   # placar/stats ao vivo + finalização (Auto Green/Red)
    python run.py analytics                   # motor de confiança + EV
    python run.py pipeline                    # odds -> analytics (cron de 30 min)
    python run.py dvp                         # recalcula DvP
    python run.py teams                       # mercados de time/jogo (escanteios, gols 1T, faltas...)
    python run.py team_stats --days 60        # carga de estatísticas de time de jogos antigos
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
                                    "pipeline", "dvp", "live", "setup", "teams", "team_stats",
                                    "context", "model_props", "live_alerts"])
    ap.add_argument("--sports", default=",".join(SPORTS))
    ap.add_argument("--days", type=int, default=30)
    args = ap.parse_args()
    sports = [s.strip() for s in args.sports.split(",") if s.strip() in SPORTS]

    from jobs import (backfill, compute_analytics, compute_team_analytics, live_alerts, live_worker,
                      model_props, sync_boxscores, sync_context, sync_schedule)

    def safe(fn, *a):
        """Etapas novas não podem derrubar o resto do ciclo (se o ESPN falhar, segue)."""
        try:
            fn(*a)
        except Exception:
            log.exception("etapa %s falhou — seguindo", getattr(fn, "__module__", fn))

    job = args.job
    if job == "backfill":
        backfill.run(sports, args.days)
    elif job == "schedule":
        sync_schedule.run(sports)
        safe(sync_context.run, sports)
    elif job == "context":
        sync_context.run(sports)
    elif job == "model_props":
        model_props.run(sports)
    elif job == "live_alerts":
        live_alerts.run()
    elif job == "odds":
        _odds(sports)
    elif job == "boxscores":
        sync_boxscores.run(sports)
        safe(live_alerts.run)
    elif job == "analytics":
        compute_analytics.run()
    elif job == "pipeline":
        safe(_odds, sports)
        safe(model_props.run, sports)
        compute_analytics.run()
        compute_team_analytics.run()
    elif job == "teams":
        compute_team_analytics.run()
    elif job == "team_stats":
        sync_boxscores.run_missing_team_stats(sports, days=args.days)
    elif job == "dvp":
        _dvp()
    elif job == "live":
        live_worker.run()
    elif job == "setup":
        backfill.run(sports, args.days)
        sync_boxscores.run_missing_team_stats(sports, days=args.days + 1)
        sync_schedule.run(sports)
        safe(sync_context.run, sports)
        _dvp()
        safe(_odds, sports)
        safe(model_props.run, sports)
        compute_analytics.run()
        compute_team_analytics.run()


if __name__ == "__main__":
    main()
