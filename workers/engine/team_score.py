"""
Score (0-100) para mercados de TIME / JOGO — espelhado em web/lib/teamEngine.ts
(o front recalcula quando o usuário mexe na linha; os pesos têm que ser iguais).

Componentes -> probabilidade de acerto do lado escolhido:
    L10 0.25 · L5 0.10 · L20 0.10 · H2H 0.15 · Casa/Fora 0.10 · Temporada 0.05 · Matchup 0.10 · Projeção 0.15
Hit rates com encolhimento Bayesiano para 0.5 (a=3). Score = 100*(0.5 + (p-0.5)*R), R = confiabilidade.
"""
from __future__ import annotations

import math
from statistics import mean, pstdev
from typing import Sequence

WEIGHTS = {"l10": 0.25, "l5": 0.10, "l20": 0.10, "h2h": 0.15, "venue": 0.10, "season": 0.05,
           "matchup": 0.10, "proj": 0.15}
PRIOR = 3.0


def hit(v: float, line: float, side: str) -> float:
    if v == line:
        return 0.5
    return 1.0 if (v > line) == (side == "over") else 0.0


def rate(vals: Sequence[float], line: float, side: str) -> tuple[float, int]:
    return sum(hit(v, line, side) for v in vals), len(vals)


def shrink(h: float, n: int) -> float:
    return (h + PRIOR * 0.5) / (n + PRIOR)


def _pois_cdf(k: int, lam: float) -> float:
    if k < 0:
        return 0.0
    term = total = math.exp(-lam)
    for i in range(1, k + 1):
        term *= lam / i
        total += term
    return min(1.0, total)


def proj_prob(mu: float, sd: float, line: float, side: str) -> float:
    if mu <= 0:
        return 0.0 if side == "over" else 1.0
    if mu < 8:
        p_over = 1 - _pois_cdf(math.floor(line), mu)
    else:
        sd = max(sd, 0.15 * mu, 1.0)
        z = (math.floor(line) + 0.5 - mu) / (sd * math.sqrt(2))
        p_over = 1 - 0.5 * (1 + math.erf(z))
    return p_over if side == "over" else 1 - p_over


def ewma(vals: Sequence[float], hl: float = 5.0) -> float:
    d = 0.5 ** (1 / hl)
    w = [d ** i for i in range(len(vals))]
    return sum(v * x for v, x in zip(vals, w)) / sum(w)


def default_line(proj: float) -> float:
    base = math.floor(proj)
    line = base + 0.5 if proj - base >= 0.5 else base - 0.5
    return max(0.5, line)


def grade(factor: float | None, side: str) -> str | None:
    if factor is None:
        return None
    f = factor if side == "over" else (2 - factor)
    return "A" if f >= 1.15 else "B" if f >= 1.05 else "C" if f >= 0.95 else "D" if f >= 0.85 else "F"


def score(series: dict[str, Sequence[float]], line: float, side: str, projection: float | None,
          sd: float | None, matchup_factor: float | None) -> tuple[int, float, dict[str, float]]:
    """series: l20 (mais recente primeiro), h2h, venue, season."""
    l20 = list(series.get("l20", []))
    comps: dict[str, float] = {}
    for key, window in (("l5", l20[:5]), ("l10", l20[:10]), ("l20", l20[:20]),
                        ("h2h", series.get("h2h", [])), ("venue", series.get("venue", [])),
                        ("season", series.get("season", []))):
        if window:
            h, n = rate(window, line, side)
            comps[key] = shrink(h, n)
    if matchup_factor is not None:
        shift = max(-0.25, min(0.25, (matchup_factor - 1) * 1.5))
        comps["matchup"] = 0.5 + shift if side == "over" else 0.5 - shift
    if projection is not None and len(l20) >= 3:
        comps["proj"] = proj_prob(projection, sd or 0.0, line, side)
    if not comps:
        return 50, 0.5, {}
    wsum = sum(WEIGHTS[k] for k in comps)
    p = sum(WEIGHTS[k] * v for k, v in comps.items()) / wsum
    sample = min(1.0, len(l20) / 15)
    consistency = max(0.4, min(1.0, 1 - 2 * pstdev(comps.values()))) if len(comps) > 1 else 0.6
    r = 0.5 + 0.5 * sample * consistency
    sc = round(max(0, min(100, 100 * (0.5 + (p - 0.5) * r))))
    return int(sc), round(p, 4), {k: round(v, 4) for k, v in comps.items()}


def stdev(vals: Sequence[float]) -> float:
    return pstdev(vals) if len(vals) > 1 else (mean(vals) * 0.3 if vals else 0.0)
