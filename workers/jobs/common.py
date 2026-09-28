"""Funções compartilhadas pelos jobs: resolver provedor, gravar jogos e box scores."""
from __future__ import annotations

import json
import logging

from config import SPORTS
from db import get_or_create_player, get_or_create_team, upsert
from providers.base import NBoxScore, NGame, StatsProvider
from providers.espn import ESPNProvider
from providers.esports_tennis import PandaScoreProvider, TennisProvider

log = logging.getLogger("propsedge")
_cache: dict[str, StatsProvider] = {}

# ordem de "maturidade" do status: nunca regredir (ex.: final -> live por cache do provedor)
_RANK = {"scheduled": 0, "postponed": 0, "live": 1, "final": 2, "cancelled": 2}


def provider_for(sport_id: str) -> StatsProvider:
    kind = SPORTS[sport_id].stats_provider
    if kind not in _cache:
        _cache[kind] = {"espn": ESPNProvider, "pandascore": PandaScoreProvider, "tennis": TennisProvider}[kind]()
    return _cache[kind]


def parse_minute(clock: str | None) -> float | None:
    """Relógio do futebol no ESPN: "67'", "45'+2'", "90'+5'", "67:12" -> minuto de jogo."""
    if not clock:
        return None
    total, found = 0.0, False
    for part in str(clock).split("+"):
        part = part.split(":")[0]
        digits = "".join(ch for ch in part if ch.isdigit())
        if digits:
            total += float(digits)
            found = True
    return total if found else None


def upsert_game(conn, g: NGame, ext_key: str) -> int:
    ext = json.dumps({ext_key: g.ext_id, **{k: str(v) for k, v in g.meta.items()}})
    home = get_or_create_team(conn, g.sport_id, g.home_name, g.home_abbr, ext_key, g.home_ext, g.home_logo)
    away = get_or_create_team(conn, g.sport_id, g.away_name, g.away_abbr, ext_key, g.away_ext, g.away_logo)
    with conn.cursor() as cur:
        cur.execute("select id, status from games where sport_id=%s and external_ids->>%s = %s",
                    (g.sport_id, ext_key, g.ext_id))
        row = cur.fetchone()
        if row is None:
            cur.execute(
                """insert into games (sport_id, home_team_id, away_team_id, start_time, status, period, clock,
                                      home_score, away_score, external_ids)
                   values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb) returning id""",
                (g.sport_id, home, away, g.start_time, g.status, g.period, g.clock,
                 g.home_score, g.away_score, ext),
            )
            return cur.fetchone()["id"]

        status = g.status if _RANK[g.status] >= _RANK[row["status"]] else row["status"]
        cur.execute(
            """update games set start_time=%s, status=%s, period=%s, clock=%s,
                      home_score=coalesce(%s, home_score), away_score=coalesce(%s, away_score),
                      external_ids = external_ids || %s::jsonb
               where id=%s""",
            (g.start_time, status, g.period, g.clock, g.home_score, g.away_score, ext, row["id"]),
        )
        return row["id"]


def save_boxscore(conn, sport_id: str, game_id: int, box: NBoxScore, ext_key: str) -> int:
    """Grava estatísticas. Jogo em andamento -> live_player_stats. Encerrado -> player_game_stats
    e marca stats_final=true, o que dispara o trigger de liquidação (Auto Green/Red)."""
    with conn.cursor() as cur:
        cur.execute("select home_team_id, away_team_id, start_time from games where id=%s", (game_id,))
        g = cur.fetchone()
    team_of = {box.game.home_ext: g["home_team_id"], box.game.away_ext: g["away_team_id"]}

    live_rows, final_rows = [], []
    for pl in box.players:
        team_id = team_of.get(pl.team_ext)
        if team_id is None:
            continue
        opp_id = g["away_team_id"] if team_id == g["home_team_id"] else g["home_team_id"]
        pid = get_or_create_player(conn, sport_id, team_id, pl.player_name, pl.position, ext_key,
                                   pl.player_ext, pl.headshot)
        live_rows.append({"game_id": game_id, "player_id": pid, "stats": pl.stats})
        if box.complete:
            final_rows.append({
                "player_id": pid, "game_id": game_id, "game_date": g["start_time"].date(),
                "sport_id": sport_id, "team_id": team_id, "opponent_team_id": opp_id,
                "is_home": team_id == g["home_team_id"], "position": pl.position,
                "minutes": pl.minutes, "dnp": pl.dnp or not pl.stats, "stats": pl.stats,
            })

    # estatísticas de time (escanteios, faltas, gols 1T, pontos por quarto...)
    live_team, final_team = [], []
    for tl in box.teams:
        team_id = team_of.get(tl.team_ext)
        if team_id is None:
            continue
        opp_id = g["away_team_id"] if team_id == g["home_team_id"] else g["home_team_id"]
        live_team.append({"game_id": game_id, "team_id": team_id, "stats": tl.stats})
        if box.complete:
            final_team.append({"team_id": team_id, "game_id": game_id, "game_date": g["start_time"].date(),
                               "sport_id": sport_id, "opponent_team_id": opp_id,
                               "is_home": team_id == g["home_team_id"], "stats": tl.stats})
    upsert(conn, "live_team_stats", live_team, conflict=("game_id", "team_id"))
    # foto das estatísticas (futebol ao vivo) -> índice de pressão e alertas (jobs/live_alerts.py)
    if sport_id == "soccer" and not box.complete and box.game.status == "live" and live_team:
        minute = parse_minute(box.game.clock)
        with conn.cursor() as cur:
            cur.executemany(
                """insert into live_team_snapshots (game_id, team_id, minute, stats)
                   values (%s,%s,%s,%s::jsonb) on conflict do nothing""",
                [(r["game_id"], r["team_id"], minute, json.dumps(r["stats"])) for r in live_team],
            )
    if final_team:
        upsert(conn, "team_game_stats", final_team, conflict=("team_id", "game_id"))

    upsert(conn, "live_player_stats", live_rows, conflict=("game_id", "player_id"))
    if box.complete and (final_rows or final_team):
        upsert(conn, "player_game_stats", final_rows, conflict=("player_id", "game_id", "game_date"))
        with conn.cursor() as cur:
            # esta linha dispara games_settle -> settle_game() no Postgres
            cur.execute(
                "update games set status='final', stats_final=true, home_score=%s, away_score=%s where id=%s",
                (box.game.home_score, box.game.away_score, game_id),
            )
        log.info("jogo %s finalizado: %s linhas de stats, liquidação disparada", game_id, len(final_rows))
    return len(live_rows)
