"""
LIVE TRACKER — processo contínuo (Fly.io / Railway / Render, ~US$5/mês).

Loop:
  1. Busca jogos ao vivo (ou começando em até 10 min) dos esportes com box score.
  2. Para cada um, baixa o box score e faz upsert em `games` (placar/clock) e `live_player_stats`.
  3. O Supabase Realtime publica essas mudanças via WebSocket -> o front atualiza sozinho.
  4. Quando o provedor marca o jogo como encerrado: grava `player_game_stats` + stats_final=true
     -> trigger `games_settle` -> settle_game() -> Green/Red + bankroll, tudo dentro do Postgres.

Por que não serverless aqui? Funções serverless têm timeout e cold start; polling de 20s
precisa de um processo vivo. O resto (odds, agenda, analytics) roda em cron serverless.
"""
from __future__ import annotations

import os
import signal
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from config import LIVE_POLL_SECONDS, SPORTS
from db import connect
from jobs.common import log, provider_for, save_boxscore, upsert_game

LIVE_SQL = """
select id, sport_id, external_ids from games
where sport_id = any(%s)
  and not stats_final
  and (status = 'live' or (status = 'scheduled' and start_time between now() - interval '3 hours'
                                                                  and now() + interval '10 minutes'))
"""

_running = True


def _stop(*_):
    global _running
    _running = False
    log.info("encerrando live worker...")


def _poll_game(g: dict) -> None:
    prov = provider_for(g["sport_id"])
    ext = g["external_ids"].get(prov.ext_key)
    if not ext:
        return
    try:
        box = prov.boxscore(g["sport_id"], ext, g["external_ids"])
    except NotImplementedError:
        return
    except Exception as e:  # rede instável não pode derrubar o loop
        log.warning("live %s: %s", g["id"], e)
        return
    if not box:
        return
    with connect() as conn:
        upsert_game(conn, box.game, prov.ext_key)          # placar, período, relógio, status
        save_boxscore(conn, g["sport_id"], g["id"], box, prov.ext_key)
        conn.commit()


def _periodic_jobs(sports: list[str]) -> None:
    """Modo 'tudo em um' (RUN_ALL_JOBS=1): substitui os crons do GitHub Actions num único processo."""
    from jobs import compute_analytics, sync_schedule
    from run import _odds
    last_sched = last_pipe = 0.0
    while _running:
        now = time.monotonic()
        try:
            if now - last_sched > 3 * 3600:
                sync_schedule.run(list(SPORTS))
                last_sched = now
            if now - last_pipe > 30 * 60:
                _odds(list(SPORTS))
                compute_analytics.run()
                last_pipe = now
        except Exception:
            log.exception("erro nos jobs periódicos")
        time.sleep(30)


def run() -> None:
    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    sports = [s for s, c in SPORTS.items() if c.stats_provider == "espn"]
    log.info("live worker iniciado (%ss) para %s", LIVE_POLL_SECONDS, sports)
    if os.getenv("RUN_ALL_JOBS") == "1":
        threading.Thread(target=_periodic_jobs, args=(sports,), daemon=True).start()
        log.info("modo tudo-em-um: agenda (3h) e odds+análise (30min) rodando neste processo")
    with ThreadPoolExecutor(max_workers=8) as pool:
        while _running:
            started = time.monotonic()
            try:
                with connect() as conn, conn.cursor() as cur:
                    cur.execute(LIVE_SQL, (sports,))
                    games = cur.fetchall()
                list(pool.map(_poll_game, games))
                if games:
                    log.info("live: %d jogos atualizados", len(games))
            except Exception:
                log.exception("erro no ciclo live")
            time.sleep(max(1.0, LIVE_POLL_SECONDS - (time.monotonic() - started)))
