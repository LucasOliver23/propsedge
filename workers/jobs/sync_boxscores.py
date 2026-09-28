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


MISSING_TEAM_SQL = """
select g.id, g.sport_id, g.external_ids
from games g
where g.sport_id = any(%s)
  and g.status = 'final' and g.stats_final
  and g.start_time > now() - make_interval(days => %s)
  and not exists (select 1 from team_game_stats t where t.game_id = g.id)
order by g.start_time desc
limit %s
"""


def run_missing_team_stats(sports: list[str], days: int = 60, limit: int = 5000, workers: int = 8) -> dict[str, int]:
    """Preenche estatísticas de TIME de jogos já finalizados (carga inicial dos mercados de time)."""
    with connect() as conn, conn.cursor() as cur:
        cur.execute(MISSING_TEAM_SQL, (sports, days, limit))
        games = cur.fetchall()
    log.info("stats de time: %d jogos finalizados sem estatística de time", len(games))
    counts: dict[str, int] = {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for res in pool.map(_process, games):
            counts[res] = counts.get(res, 0) + 1
    log.info("stats de time: %s", counts)
    return counts
