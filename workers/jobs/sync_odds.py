"""Importa odds de props (The Odds API) e cruza com jogos/jogadores do banco.

Controle de créditos (cada evento custa nº de mercados x nº de regiões):
  * só jogos que começam nas próximas `horizon_hours` e que já existem no banco (vindos do ESPN)
  * prioriza os jogos que começam antes; no máximo ODDS_MAX_EVENTS_PER_RUN por execução
  * não rebusca o mesmo jogo antes de ODDS_REFRESH_MINUTES (exceto nas 2h antes do início)
  * até ODDS_MAX_MARKETS mercados por esporte (stat_types.priority)
  * para de gastar quando o saldo cai abaixo de ODDS_MIN_REMAINING
O endpoint /events é gratuito, então listar os jogos não consome créditos.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from config import (ODDS_MAX_EVENTS_PER_RUN, ODDS_MAX_MARKETS, ODDS_MIN_REMAINING,
                    ODDS_REFRESH_MINUTES, SPORTS)
from db import connect, upsert
from jobs.common import log
from providers.the_odds_api import OddsAPI, parse_time

MATCH_GAME_SQL = """
select g.id, g.home_team_id, g.away_team_id, g.odds_fetched_at, g.start_time
from games g
join teams h on h.id = g.home_team_id
join teams a on a.id = g.away_team_id
where g.sport_id = %(sport)s
  and g.status = 'scheduled'
  and abs(extract(epoch from g.start_time - %(start)s)) < 3 * 3600
  and similarity(lower(unaccent(h.name)), lower(unaccent(%(home)s))) > 0.4
  and similarity(lower(unaccent(a.name)), lower(unaccent(%(away)s))) > 0.4
order by similarity(lower(unaccent(h.name)), lower(unaccent(%(home)s)))
       + similarity(lower(unaccent(a.name)), lower(unaccent(%(away)s))) desc
limit 1
"""


def _needs_refresh(game: dict, now: datetime) -> bool:
    last = game["odds_fetched_at"]
    if last is None:
        return True
    age = now - last
    if game["start_time"] - now < timedelta(hours=2):      # perto do jogo: linhas mexem mais
        return age > timedelta(minutes=max(30, ODDS_REFRESH_MINUTES // 3))
    return age > timedelta(minutes=ODDS_REFRESH_MINUTES)


def run(sports: list[str], horizon_hours: int = 36) -> int:
    api = OddsAPI()
    now = datetime.now(timezone.utc)
    queue: list[tuple[datetime, str, str, str, dict, dict[str, str]]] = []

    with connect() as conn:
        # 1) monta a fila (grátis)
        for sport_id in sports:
            cfg = SPORTS[sport_id]
            if not cfg.odds_api_keys:
                continue
            with conn.cursor() as cur:
                cur.execute("""select key, odds_api_market from stat_types
                               where sport_id=%s and odds_api_market is not null
                               order by priority, key limit %s""", (sport_id, ODDS_MAX_MARKETS))
                market_to_stat = {r["odds_api_market"]: r["key"] for r in cur.fetchall()}
            if not market_to_stat:
                continue
            for sport_key in cfg.odds_api_keys:
                try:
                    events = api.events(sport_key)
                except Exception as e:
                    log.warning("[%s] events indisponível: %s", sport_key, e)
                    continue
                for ev in events:
                    start = parse_time(ev["commence_time"])
                    if not (now < start < now + timedelta(hours=horizon_hours)):
                        continue
                    with conn.cursor() as cur:
                        cur.execute(MATCH_GAME_SQL, {"sport": sport_id, "start": start,
                                                     "home": ev["home_team"], "away": ev["away_team"]})
                        game = cur.fetchone()
                    if not game:
                        log.info("[%s] sem jogo no banco para %s x %s", sport_id, ev["home_team"], ev["away_team"])
                        continue
                    if _needs_refresh(game, now):
                        queue.append((start, sport_id, sport_key, ev["id"], game, market_to_stat))

        queue.sort(key=lambda q: q[0])
        log.info("odds: %d jogos precisam de atualização; processando até %d", len(queue), ODDS_MAX_EVENTS_PER_RUN)

        # 2) busca odds (pago)
        done = 0
        for _, sport_id, sport_key, event_id, game, market_to_stat in queue[:ODDS_MAX_EVENTS_PER_RUN]:
            if api.remaining is not None and api.remaining < ODDS_MIN_REMAINING:
                log.warning("saldo da Odds API baixo (%s) — parando", api.remaining)
                break
            try:
                _ingest_event(conn, api, sport_id, sport_key, event_id, game, market_to_stat)
                conn.commit()
                done += 1
            except Exception:
                conn.rollback()
                log.exception("[%s] falha no evento %s", sport_id, event_id)
        log.info("odds: %d eventos atualizados; créditos restantes: %s", done, api.remaining)
        return done


def _ingest_event(conn, api: OddsAPI, sport_id: str, sport_key: str, event_id: str,
                  game: dict, market_to_stat: dict[str, str]) -> None:
    odds = api.props(sport_key, event_id, market_to_stat)
    with conn.cursor() as cur:
        cur.execute("""update games set odds_fetched_at = now(),
                              external_ids = external_ids || jsonb_build_object('odds_api', %s::text)
                       where id=%s""", (event_id, game["id"]))
        # casas novas são cadastradas automaticamente
        if api.book_titles:
            cur.executemany(
                "insert into bookmakers (id, name, is_sharp) values (%s,%s,%s) on conflict (id) do nothing",
                [(k, v, k == "pinnacle") for k, v in api.book_titles.items()],
            )

    player_cache: dict[str, int | None] = {}
    rows: list[dict] = []
    unmatched: set[str] = set()
    for o in odds:
        if o.player_name not in player_cache:
            with conn.cursor() as cur:
                cur.execute("select match_player(%s, %s) as id",
                            (o.player_name, [game["home_team_id"], game["away_team_id"]]))
                player_cache[o.player_name] = cur.fetchone()["id"]
        pid = player_cache[o.player_name]
        if pid is None:
            unmatched.add(o.player_name)   # sem histórico no banco ainda
            continue
        mkt = upsert(conn, "prop_markets",
                     [{"game_id": game["id"], "player_id": pid, "sport_id": sport_id, "stat_key": o.stat_key}],
                     conflict=("game_id", "player_id", "stat_key"), update=["stat_key"], returning="id")[0]
        rows.append({"market_id": mkt["id"], "bookmaker_id": o.bookmaker, "line": o.line,
                     "over_odds": o.over, "under_odds": o.under})

    now = datetime.now(timezone.utc)
    upsert(conn, "odds_current", [{**r, "updated_at": now} for r in rows], conflict=("market_id", "bookmaker_id"))
    if rows:
        with conn.cursor() as cur:
            cur.executemany(
                "insert into odds_history (market_id, bookmaker_id, line, over_odds, under_odds) values (%s,%s,%s,%s,%s)",
                [(r["market_id"], r["bookmaker_id"], r["line"], r["over_odds"], r["under_odds"]) for r in rows],
            )
    log.info("[%s] evento %s: %d cotações, %d jogadores sem histórico%s", sport_id, event_id, len(rows),
             len(unmatched), f" (ex.: {', '.join(list(unmatched)[:3])})" if unmatched else "")
