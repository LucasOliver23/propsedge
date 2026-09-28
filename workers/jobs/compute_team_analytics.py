"""Mercados de TIME e de JOGO (escanteios, gols, 1º tempo, faltas, chutes, cartões, pontos por quarto...).

Para cada jogo das próximas 72h calcula, por mercado:
  * home  -> estatística do mandante      (ex.: Criciúma faltas)
  * away  -> estatística do visitante     (ex.: Operário gols)
  * match -> soma dos dois times          (ex.: escanteios do jogo)
e grava em team_market_analytics as séries (L20, H2H, casa/fora, temporada) + projeção, matchup e score.
Também tira o "snapshot" dos picks do dia (score >= PICK_MIN_SCORE) para o recap da rodada.
Não consome créditos de API: usa só o banco.
"""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from db import connect
from engine.team_score import book_line, btts_mu, ewma, grade, poisson_match, rate, score, stdev
from jobs.common import log

PICK_MIN_SCORE = 65
MIN_GAMES = 5

GAMES_SQL = """
select g.id, g.sport_id, g.start_time, g.home_team_id, g.away_team_id,
       g.external_ids ->> 'espn_path' as league, ht.abbr as home_abbr, at.abbr as away_abbr
from games g
join teams ht on ht.id = g.home_team_id
join teams at on at.id = g.away_team_id
where g.status = 'scheduled'
  and g.start_time between now() and now() + interval '72 hours'
  and exists (select 1 from team_market_types m where m.sport_id = g.sport_id)
"""

HISTORY_SQL = """
select a.game_id, a.game_date, a.is_home, a.stats as s_for, b.stats as s_against,
       a.opponent_team_id, o.abbr as opp_abbr
from team_game_stats a
join team_game_stats b on b.game_id = a.game_id and b.team_id <> a.team_id
join teams o on o.id = a.opponent_team_id
where a.team_id = %s and a.game_date < %s
order by a.game_date desc
limit 40
"""

LEAGUE_AVG_SQL = """
select coalesce(g.external_ids ->> 'espn_path', t.sport_id) as league, s.key, avg(s.value::numeric) as avg
from team_game_stats t
join games g on g.id = t.game_id
cross join lateral jsonb_each_text(t.stats) s
where t.sport_id = %s and t.game_date > current_date - 150 and s.value ~ '^-?[0-9]+(\\.[0-9]+)?$'
group by 1, 2
"""


def _num(d: dict, k: str) -> float | None:
    v = d.get(k)
    return float(v) if v is not None else None


def _team_series(rows: list[dict], key: str, opp_id: int, at_home: bool) -> dict:
    l20, venue, season, h2h = [], [], [], []
    for r in rows:
        v = _num(r["s_for"], key)
        if v is None:
            continue
        item = {"v": v, "d": r["game_date"].isoformat(), "o": r["opp_abbr"], "h": r["is_home"]}
        if len(l20) < 20:
            l20.append(item)
        if r["is_home"] == at_home and len(venue) < 10:
            venue.append(item)
        if len(season) < 40:
            season.append(v)
        if r["opponent_team_id"] == opp_id and len(h2h) < 10:
            h2h.append(item)
    return {"l20": l20, "venue": venue, "season": season, "h2h": h2h}


def _allowed(rows: list[dict], key: str) -> float | None:
    vals = [x for x in (_num(r["s_against"], key) for r in rows[:10]) if x is not None]
    return sum(vals) / len(vals) if len(vals) >= 3 else None


def _match_series(rows_h: list[dict], rows_a: list[dict], key: str, away_id: int, h_abbr: str, a_abbr: str,
                  combine=lambda a, b: a + b) -> dict:
    def totals(rows, own_abbr, home_side):
        out = []
        for r in rows:
            a, b = _num(r["s_for"], key), _num(r["s_against"], key)
            if a is None or b is None:
                continue
            out.append({"v": combine(a, b), "d": r["game_date"].isoformat(), "g": r["game_id"],
                        "o": f"{own_abbr} x {r['opp_abbr']}" if r["is_home"] else f"{r['opp_abbr']} x {own_abbr}",
                        "h": r["is_home"], "vs": r["opponent_team_id"], "side": home_side})
        return out

    th, ta = totals(rows_h, h_abbr, True), totals(rows_a, a_abbr, False)
    seen, merged = set(), []
    for it in sorted(th + ta, key=lambda x: x["d"], reverse=True):
        if it["g"] in seen:
            continue
        seen.add(it["g"])
        merged.append(it)
    venue = [x for x in th if x["h"]][:5] + [x for x in ta if not x["h"]][:5]
    h2h = [x for x in th if x["vs"] == away_id][:10]
    clean = lambda xs: [{"v": x["v"], "d": x["d"], "o": x["o"], "h": x["h"]} for x in xs]  # noqa: E731
    return {
        "l20": clean(merged[:20]), "venue": clean(venue), "h2h": clean(h2h),
        "season": [x["v"] for x in merged[:40]],
        "home_l10": [x["v"] for x in th[:10]], "away_l10": [x["v"] for x in ta[:10]],
    }


def _analyse(series: dict, projection: float | None, factor: float | None,
             fixed_line: float | None = None) -> dict | None:
    l20 = [x["v"] for x in series["l20"]]
    if len(l20) < MIN_GAMES or projection is None:
        return None
    sd = stdev(l20)
    # linha realista (~odd 1.85), não a "fácil"; mercados sim/não (ambas marcam) usam 0.5 fixo
    line = fixed_line if fixed_line is not None else book_line(projection, sd)
    vals = {"l20": l20, "h2h": [x["v"] for x in series["h2h"]], "venue": [x["v"] for x in series["venue"]],
            "season": series["season"]}
    best = None
    for side in ("over", "under"):
        sc, p, _ = score(vals, line, side, projection, sd, factor)
        if best is None or sc > best[0]:
            best = (sc, p, side)
    sc, p, side = best
    h, n = rate(l20[:10], line, side)
    return {"line": line, "side": side, "score": sc, "prob": p, "hit_l10": h / n if n else None,
            "grade": grade(factor, side), "sd": round(sd, 3)}


def run() -> None:
    now = datetime.now(timezone.utc)
    rows_out, picks, preds = [], [], []
    with connect() as conn, conn.cursor() as cur:
        cur.execute(GAMES_SQL)
        games = cur.fetchall()
        if not games:
            log.info("mercados de time: nenhum jogo nas próximas 72h")
            return
        cur.execute("select sport_id, key from team_market_types")
        markets: dict[str, list[str]] = defaultdict(list)
        for r in cur.fetchall():
            markets[r["sport_id"]].append(r["key"])

        league_avg: dict[str, dict[tuple[str, str], float]] = {}
        hist_cache: dict[tuple[int, str], list[dict]] = {}

        def history(team_id: int, before) -> list[dict]:
            ck = (team_id, str(before))
            if ck not in hist_cache:
                cur.execute(HISTORY_SQL, (team_id, before))
                hist_cache[ck] = cur.fetchall()
            return hist_cache[ck]

        for g in games:
            sport = g["sport_id"]
            if sport not in league_avg:
                cur.execute(LEAGUE_AVG_SQL, (sport,))
                league_avg[sport] = {(r["league"], r["key"]): float(r["avg"]) for r in cur.fetchall()}
            before = g["start_time"].date()
            rows_h, rows_a = history(g["home_team_id"], before), history(g["away_team_id"], before)
            lg_key = g["league"] or sport

            goal_proj = None
            for key in markets[sport]:
                if key == "btts":
                    continue           # calculado abaixo a partir dos gols projetados
                lavg = league_avg[sport].get((lg_key, key))
                subjects = []
                for subject, team_id, rows, opp_rows, opp_id, at_home in (
                    ("home", g["home_team_id"], rows_h, rows_a, g["away_team_id"], True),
                    ("away", g["away_team_id"], rows_a, rows_h, g["home_team_id"], False),
                ):
                    s = _team_series(rows, key, opp_id, at_home)
                    vals = [x["v"] for x in s["l20"]]
                    allowed = _allowed(opp_rows, key)
                    if not vals:
                        subjects.append(None)
                        continue
                    base = ewma(vals[:10])
                    proj = 0.6 * base + 0.4 * allowed if allowed is not None else base
                    factor = min(max(allowed / lavg, 0.2), 5.0) if (allowed is not None and lavg) else None
                    res = _analyse(s, proj, factor)
                    subjects.append((proj, factor))
                    if res:
                        s.update({"allowed_avg": allowed, "league_avg": lavg, "sd": res["sd"]})
                        rows_out.append((g["id"], subject, key, team_id, res, proj, factor, s))

                if key == "goals" and all(subjects):
                    goal_proj = (subjects[0][0], subjects[1][0])

                # jogo (soma dos dois)
                if all(subjects):
                    ms = _match_series(rows_h, rows_a, key, g["away_team_id"], g["home_abbr"] or "CASA",
                                       g["away_abbr"] or "FORA")
                    proj = subjects[0][0] + subjects[1][0]
                    fs = [f for _, f in subjects if f is not None]
                    factor = sum(fs) / len(fs) if fs else None
                    res = _analyse(ms, proj, factor)
                    if res:
                        ms.update({"home_avg": round(subjects[0][0], 2), "away_avg": round(subjects[1][0], 2),
                                   "league_avg": (lavg * 2) if lavg else None, "sd": res["sd"]})
                        rows_out.append((g["id"], "match", key, None, res, proj, factor, ms))

            # futebol: 1X2 / over / ambas marcam pelos gols esperados (Poisson)
            if sport == "soccer" and goal_proj:
                lh, la = goal_proj
                pm = poisson_match(lh, la)
                preds.append((g["id"], sport, round(lh, 3), round(la, 3), round(pm["home"], 4), round(pm["draw"], 4),
                               round(pm["away"], 4), round(pm["over15"], 4), round(pm["over25"], 4),
                               round(pm["btts"], 4)))
                ms = _match_series(rows_h, rows_a, "goals", g["away_team_id"], g["home_abbr"] or "CASA",
                                   g["away_abbr"] or "FORA", combine=lambda a, b: float(a > 0 and b > 0))
                mu = btts_mu(pm["btts"])
                res = _analyse(ms, mu, None, fixed_line=0.5)
                if res:
                    ms.update({"home_avg": round(lh, 2), "away_avg": round(la, 2), "p_btts": round(pm["btts"], 4),
                               "sd": res["sd"]})
                    rows_out.append((g["id"], "match", "btts", None, res, mu, None, ms))

            if g["start_time"] - now < timedelta(hours=24):
                for (gid, subject, key, team_id, res, *_rest) in [r for r in rows_out if r[0] == g["id"]]:
                    if res["score"] >= PICK_MIN_SCORE:
                        picks.append((gid, subject, team_id, key, res["side"], res["line"], res["score"], res["prob"]))

        cur.executemany(
            """insert into team_market_analytics
                 (game_id, subject, stat_key, team_id, default_line, default_side, projection, model_prob, score,
                  hit_l10, matchup_grade, matchup_factor, data, computed_at)
               values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb, now())
               on conflict (game_id, subject, stat_key) do update set
                 team_id = excluded.team_id, default_line = excluded.default_line, default_side = excluded.default_side,
                 projection = excluded.projection, model_prob = excluded.model_prob, score = excluded.score,
                 hit_l10 = excluded.hit_l10, matchup_grade = excluded.matchup_grade,
                 matchup_factor = excluded.matchup_factor, data = excluded.data, computed_at = now()""",
            [(gid, subj, key, tid, r["line"], r["side"], round(proj, 2), r["prob"], r["score"], r["hit_l10"],
              r["grade"], round(f, 4) if f is not None else None, json.dumps(data, default=str))
             for gid, subj, key, tid, r, proj, f, data in rows_out],
        )
        if preds:
            cur.executemany(
                """insert into game_predictions (game_id, sport_id, lambda_home, lambda_away, p_home, p_draw, p_away,
                                                 p_over15, p_over25, p_btts, computed_at)
                   values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, now())
                   on conflict (game_id) do update set
                     lambda_home=excluded.lambda_home, lambda_away=excluded.lambda_away, p_home=excluded.p_home,
                     p_draw=excluded.p_draw, p_away=excluded.p_away, p_over15=excluded.p_over15,
                     p_over25=excluded.p_over25, p_btts=excluded.p_btts, computed_at=now()""",
                preds,
            )
        if picks:
            cur.executemany(
                """insert into team_picks (game_id, subject, team_id, stat_key, side, line, score, model_prob)
                   values (%s,%s,%s,%s,%s,%s,%s,%s) on conflict (game_id, subject, stat_key) do nothing""",
                picks,
            )
        conn.commit()
    log.info("mercados de time: %d análises, %d previsões 1X2, %d picks (score >= %d)",
             len(rows_out), len(preds), len(picks), PICK_MIN_SCORE)
