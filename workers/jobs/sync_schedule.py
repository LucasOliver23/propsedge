"""Importa a agenda (hoje-1 .. hoje+2) de todos os esportes. Cron: a cada 3h."""
from __future__ import annotations

from db import connect
from jobs.common import log, provider_for, upsert_game


def run(sports: list[str], days_ahead: int = 2, days_back: int = 1) -> int:
    total = 0
    for sport_id in sports:
        try:
            prov = provider_for(sport_id)
            games = prov.schedule(sport_id, days_ahead=days_ahead, days_back=days_back)
        except NotImplementedError as e:
            log.warning("[%s] agenda indisponível: %s", sport_id, e)
            continue
        except Exception:
            log.exception("[%s] falha ao buscar agenda", sport_id)
            continue
        with connect() as conn:
            for g in games:
                upsert_game(conn, g, prov.ext_key)
            conn.commit()
        total += len(games)
        log.info("[%s] %d jogos sincronizados", sport_id, len(games))
    return total
