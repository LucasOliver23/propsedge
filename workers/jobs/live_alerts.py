"""Índice de PRESSÃO ao vivo + ALERTAS de entrada (futebol).

O ESPN não informa "ataques perigosos" (o que o PackBall usa); aqui a pressão é aproximada com o que
ele informa: chutes no gol, chutes para fora e escanteios, nos últimos ~15 minutos de jogo.

    pontos = 3 x chutes no gol + 1 x chutes para fora + 1.5 x escanteios   (por 10 minutos)
    pressão (0-100) = pontos / PRESSURE_FULL x 100

Com o GitHub Actions (a cada 15 min) a janela é a diferença entre duas coletas; com o worker ao vivo
(Fly.io, a cada 20 s) fica bem mais fino. Os alertas são gravados uma vez por jogo/regra e aparecem
em tempo real na aba "Ao vivo".
"""
from __future__ import annotations

import json

from db import connect
from jobs.common import log

PRESSURE_FULL = 8.0        # pontos por 10 min que equivalem a pressão 100
WINDOW_MIN = 8             # janela mínima (min de jogo) entre as duas fotos
WINDOW_MAX = 25            # foto mais antiga aceita para a janela
HIGH = 60                  # pressão "alta"

LIVE_SQL = """
select g.id, g.home_team_id, g.away_team_id, g.home_score, g.away_score, g.clock,
       ht.name as home_name, at.name as away_name
from games g
join teams ht on ht.id = g.home_team_id
join teams at on at.id = g.away_team_id
where g.sport_id = 'soccer' and g.status = 'live'
"""

SNAP_SQL = """
select team_id, minute, stats, captured_at
from live_team_snapshots
where game_id = %s and captured_at > now() - interval '2 hours'
order by captured_at desc
"""

CORNER_LINE_SQL = """
select default_line from team_market_analytics where game_id = %s and subject = 'match' and stat_key = 'corners'
"""


def _v(stats: dict, key: str) -> float:
    try:
        return float(stats.get(key) or 0)
    except (TypeError, ValueError):
        return 0.0


def points(stats: dict) -> float:
    sot = _v(stats, "shots_on_target")
    off = max(_v(stats, "shots") - sot, 0)
    return 3 * sot + off + 1.5 * _v(stats, "corners")


def pressure(latest: dict, older: dict | None, minute: float | None, older_minute: float | None) -> tuple[float, float]:
    """Retorna (pressão 0-100, janela em minutos). Sem foto antiga, usa a média desde o início."""
    if older is not None and minute is not None and older_minute is not None and minute - older_minute >= WINDOW_MIN:
        window = minute - older_minute
        delta = points({k: _v(latest, k) - _v(older, k) for k in ("shots_on_target", "shots", "corners")})
    elif minute and minute >= 10:
        window = minute
        delta = points(latest)
    else:
        return 0.0, 0.0
    per10 = max(delta, 0) / window * 10
    return round(min(100.0, per10 / PRESSURE_FULL * 100), 1), window


def rules(minute: float, hs: int, as_: int, hp: float, ap: float, home: str, away: str,
          corners_now: float, corner_line: float | None) -> list[tuple[str, str, str, str]]:
    """Regras de alerta -> [(regra, título, mensagem, mercado sugerido)]."""
    out = []
    total = hs + as_
    top_p, top_team = (hp, home) if hp >= ap else (ap, away)
    if 55 <= minute <= 80 and total <= 1 and top_p >= HIGH:
        out.append(("gol_maduro", "Gol maduro",
                    f"{top_team} pressionando forte (pressão {top_p:.0f}) aos {minute:.0f}' com {hs}x{as_}.",
                    f"Mais de {total + 0.5} gols (jogo)"))
    if 25 <= minute <= 42 and total == 0 and (top_p >= 70 or hp + ap >= 100):
        out.append(("pressao_1t", "Pressão no 1º tempo",
                    f"0x0 aos {minute:.0f}' e {top_team} amassando (pressão {top_p:.0f}).",
                    "Mais de 0.5 gol no 1º tempo"))
    if corner_line and 25 <= minute <= 75:
        pace = corners_now / minute * 90
        if pace >= corner_line + 2 and corners_now < corner_line:
            out.append(("escanteios_ritmo", "Escanteios em ritmo alto",
                        f"{corners_now:.0f} escanteios aos {minute:.0f}' — ritmo de {pace:.1f} no jogo (linha {corner_line}).",
                        f"Mais de {corner_line} escanteios (jogo)"))
    if 60 <= minute <= 85 and abs(hs - as_) == 1:
        losing, lp = (home, hp) if hs < as_ else (away, ap)
        if lp >= HIGH:
            out.append((f"virada_{'home' if losing == home else 'away'}", "Time perdendo e pressionando",
                        f"{losing} perde por 1 gol e pressiona (pressão {lp:.0f}) aos {minute:.0f}'.",
                        f"Mais de {total + 0.5} gols / gol do {losing}"))
    return out


def run() -> int:
    n_alerts = 0
    with connect() as conn, conn.cursor() as cur:
        cur.execute(LIVE_SQL)
        games = cur.fetchall()
        for g in games:
            cur.execute(SNAP_SQL, (g["id"],))
            snaps = cur.fetchall()
            by_team: dict[int, list[dict]] = {}
            for s in snaps:
                by_team.setdefault(s["team_id"], []).append(s)
            state = {}
            for side, tid in (("home", g["home_team_id"]), ("away", g["away_team_id"])):
                lst = by_team.get(tid) or []
                if not lst:
                    continue
                latest = lst[0]
                m = float(latest["minute"]) if latest["minute"] is not None else None
                older = None
                for s in lst[1:]:
                    sm = float(s["minute"]) if s["minute"] is not None else None
                    if m is not None and sm is not None and WINDOW_MIN <= m - sm <= WINDOW_MAX:
                        older = s
                        break
                p, window = pressure(latest["stats"], older["stats"] if older else None, m,
                                     float(older["minute"]) if older and older["minute"] is not None else None)
                state[side] = {"pressure": p, "window": window, "minute": m,
                               "shots": _v(latest["stats"], "shots"), "sot": _v(latest["stats"], "shots_on_target"),
                               "corners": _v(latest["stats"], "corners"),
                               "possession": _v(latest["stats"], "possession")}
            if not state:
                continue
            minute = max((s["minute"] or 0) for s in state.values())
            hp = state.get("home", {}).get("pressure", 0.0)
            ap = state.get("away", {}).get("pressure", 0.0)
            cur.execute(
                """insert into live_game_state (game_id, sport_id, minute, home_pressure, away_pressure, data, updated_at)
                   values (%s,'soccer',%s,%s,%s,%s::jsonb, now())
                   on conflict (game_id) do update set minute=excluded.minute, home_pressure=excluded.home_pressure,
                     away_pressure=excluded.away_pressure, data=excluded.data, updated_at=now()""",
                (g["id"], minute or None, hp, ap, json.dumps(state)),
            )
            if not minute:
                continue
            cur.execute(CORNER_LINE_SQL, (g["id"],))
            cl = cur.fetchone()
            corners_now = state.get("home", {}).get("corners", 0) + state.get("away", {}).get("corners", 0)
            for rule, title, msg, market in rules(minute, g["home_score"] or 0, g["away_score"] or 0, hp, ap,
                                                  g["home_name"], g["away_name"], corners_now,
                                                  float(cl["default_line"]) if cl else None):
                cur.execute(
                    """insert into live_alerts (game_id, rule, title, message, market, minute)
                       values (%s,%s,%s,%s,%s,%s) on conflict (game_id, rule) do nothing""",
                    (g["id"], rule, title, msg, market, minute),
                )
                n_alerts += cur.rowcount
        conn.commit()
    if games:
        log.info("ao vivo: pressão de %d jogos de futebol, %d alertas novos", len(games), n_alerts)
    return n_alerts
