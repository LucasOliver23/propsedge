"""Atualiza jogos em andamento e finaliza os encerrados.

- Jogo começou  -> atualiza placar/status e live_player_stats (o "live" do plano sem servidor dedicado).
- Jogo encerrou -> grava player_game_stats + stats_final=true => trigger liquida Green/Red.
Cron: a cada 10 min. Com o live_worker (Fly.io) ligado, este job vira só uma garantia.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from db import connect
from jobs.common import log, provider_for, save_boxscore, upsert_game

PENDING_SQL = """
select id, sport_id, external_ids
from games
where sport_id = any(%s)
  and not stats_final
  and status not in ('cancelled', 'postponed')
  and start_time < now()
  and start_time > now() - make_interval(days => %s)
order by start_time
limit %s
"""


def _process(g: dict) -> str:
    try:
        prov = provider_for(g["sport_id"])
        ext = g["external_ids"].get(prov.ext_key)
        if not ext:
            return "sem-id"
        box = prov.boxscore(g["sport_id"], ext, g["external_ids"])
    except NotImplementedError:
        return "sem-provedor"
    except Exception as e:
        log.warning("box score falhou para jogo %s: %s", g["id"], e)
        return "erro"
    if not box:
        return "vazio"
    with connect() as conn:
        upsert_game(conn, box.game, prov.ext_key)
        save_boxscore(conn, g["sport_id"], g["id"], box, prov.ext_key)
        conn.commit()
    return "final" if box.complete else "live"


def run(sports: list[str], days: int = 3, limit: int = 400, workers: int = 6) -> dict[str, int]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(PENDING_SQL, (sports, days, limit))
        games = cur.fetchall()
    counts: dict[str, int] = {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for res in pool.map(_process, games):
            counts[res] = counts.get(res, 0) + 1
    log.info("box scores: %s", counts or "nenhum jogo pendente")
    return counts
