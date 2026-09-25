"""Roda o motor de confiança/EV para todas as props das próximas 36h. Cron: logo após sync_odds.

Tudo que o motor precisa (L20, H2H, DvP, média da temporada) vem em UMA query com LATERAL joins,
evitando N+1 mesmo com milhares de props.
"""
from __future__ import annotations

from collections import defaultdict

from db import connect, upsert
from engine.confidence import PropInput, compute_confidence, is_ev_alert
from engine.odds_math import BookPrice, best_price, consensus_line, market_fair_prob
from jobs.common import log

MARKETS_SQL = """
select m.id as market_id, m.stat_key, m.player_id, p.position,
       recent.vals as recent_vals, recent.opps as recent_opps,
       h2h.vals as h2h_vals, d.factor as dvp_factor, d.rank as dvp_rank, season.avg as season_avg
from prop_markets m
join games g   on g.id = m.game_id
join players p on p.id = m.player_id
join teams opp on opp.id = case when p.team_id = g.home_team_id then g.away_team_id else g.home_team_id end
left join lateral (
  select array_agg(v order by game_date desc) as vals, array_agg(oabbr order by game_date desc) as opps
  from (
    select (s.stats ->> m.stat_key)::numeric as v, s.game_date, t2.abbr as oabbr
    from player_game_stats s join teams t2 on t2.id = s.opponent_team_id
    where s.player_id = m.player_id and not s.dnp and s.game_date < g.start_time::date and s.stats ? m.stat_key
    order by s.game_date desc limit 20
  ) x
) recent on true
left join lateral (
  select array_agg(v) as vals from (
    select (s.stats ->> m.stat_key)::numeric as v
    from player_game_stats s
    where s.player_id = m.player_id and s.opponent_team_id = opp.id and not s.dnp
      and s.game_date > current_date - 730 and s.stats ? m.stat_key
    order by s.game_date desc limit 10
  ) x
) h2h on true
left join lateral (
  select avg((s.stats ->> m.stat_key)::numeric) as avg
  from player_game_stats s
  where s.player_id = m.player_id and not s.dnp and s.game_date > current_date - 200 and s.stats ? m.stat_key
) season on true
left join team_defense_vs_position d
       on d.team_id = opp.id and d.position = p.position and d.stat_key = m.stat_key
where g.status = 'scheduled'
  and g.start_time between now() and now() + interval '36 hours'
  and p.status <> 'out'
"""

ODDS_SQL = """
select o.market_id, o.bookmaker_id, o.line, o.over_odds, o.under_odds, b.is_sharp
from odds_current o join bookmakers b on b.id = o.bookmaker_id
where o.market_id = any(%s)
"""


def run() -> None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(MARKETS_SQL)
        markets = cur.fetchall()
        if not markets:
            log.info("nenhuma prop para analisar")
            return
        cur.execute(ODDS_SQL, ([m["market_id"] for m in markets],))
        prices: dict[int, list[BookPrice]] = defaultdict(list)
        for o in cur.fetchall():
            prices[o["market_id"]].append(BookPrice(
                o["bookmaker_id"], float(o["line"]),
                float(o["over_odds"]) if o["over_odds"] else None,
                float(o["under_odds"]) if o["under_odds"] else None,
                o["is_sharp"],
            ))

        rows, alerts = [], []
        for m in markets:
            book_prices = prices.get(m["market_id"], [])
            line = consensus_line(book_prices)
            if line is None:
                continue
            recent = [float(v) for v in (m["recent_vals"] or []) if v is not None]
            opps = list(m["recent_opps"] or [])
            h2h = [float(v) for v in (m["h2h_vals"] or []) if v is not None]
            dvp = float(m["dvp_factor"]) if m["dvp_factor"] is not None else None

            for side in ("over", "under"):
                bp = best_price(book_prices, line, side)
                res = compute_confidence(PropInput(
                    line=line, side=side, recent_values=recent, h2h_values=h2h, dvp_factor=dvp,
                    market_prob=market_fair_prob(book_prices, line, side),
                    best_odds=bp[1] if bp else None,
                ))
                l5, l10, l20, hh = (res.hits.get(k, (None, None)) for k in ("l5", "l10", "l20", "h2h"))
                rows.append({
                    "market_id": m["market_id"], "side": side, "line": line,
                    "l5_hits": l5[0], "l5_n": l5[1], "l10_hits": l10[0], "l10_n": l10[1],
                    "l20_hits": l20[0], "l20_n": l20[1], "h2h_hits": hh[0], "h2h_n": hh[1],
                    "season_avg": round(float(m["season_avg"]), 2) if m["season_avg"] is not None else None,
                    "l10_values": list(reversed(recent[:10])),   # antigo -> recente (eixo X do gráfico)
                    "l10_opps": list(reversed(opps[:10])),
                    "dvp_rank": m["dvp_rank"], "dvp_factor": dvp, "proj_mean": res.proj_mean,
                    "model_prob": res.model_prob,
                    "market_prob": market_fair_prob(book_prices, line, side),
                    "fair_prob": res.fair_prob, "confidence": res.confidence,
                    "best_book": bp[0] if bp else None, "best_odds": bp[1] if bp else None,
                    "ev": res.ev,
                })
                if bp and is_ev_alert(res, bp[1]):
                    alerts.append({
                        "market_id": m["market_id"], "side": side, "bookmaker_id": bp[0], "line": line,
                        "odds": bp[1], "fair_odds": round(1 / res.fair_prob, 3) if res.fair_prob else bp[1],
                        "ev": res.ev, "confidence": res.confidence,
                    })

        # arrays Postgres: psycopg adapta list -> array; o upsert só converte dict/list em JSON,
        # então passamos arrays via cursor dedicado
        _upsert_analytics(conn, rows)
        upsert(conn, "ev_alerts", alerts, conflict=("market_id", "side", "bookmaker_id", "line", "odds"),
               update=["ev", "confidence"])
        conn.commit()
        log.info("analytics: %d linhas, %d alertas EV+", len(rows), len(alerts))


def _upsert_analytics(conn, rows: list[dict]) -> None:
    if not rows:
        return
    cols = list(rows[0].keys())
    sql = (f"insert into prop_analytics ({', '.join(cols)}, computed_at) "
           f"values ({', '.join(['%s'] * len(cols))}, now()) "
           f"on conflict (market_id, side) do update set "
           + ", ".join(f"{c} = excluded.{c}" for c in cols if c not in ("market_id", "side"))
           + ", computed_at = now()")
    with conn.cursor() as cur:
        cur.executemany(sql, [[r[c] for c in cols] for r in rows])
