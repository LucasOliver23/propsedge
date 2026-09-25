"""Matemática de odds: probabilidade implícita, remoção de margem (vig), EV e Kelly."""
from __future__ import annotations

from dataclasses import dataclass
from statistics import median
from typing import Iterable


@dataclass(frozen=True)
class BookPrice:
    book: str
    line: float
    over: float | None
    under: float | None
    is_sharp: bool = False


def implied(odds: float) -> float:
    return 1.0 / odds


def devig_pair(over: float, under: float) -> tuple[float, float]:
    """Remove a margem pelo método multiplicativo. Retorna (p_over, p_under) somando 1."""
    io, iu = implied(over), implied(under)
    total = io + iu
    return io / total, iu / total


def market_fair_prob(prices: Iterable[BookPrice], line: float, side: str) -> float | None:
    """Probabilidade 'justa' do mercado para o lado, na linha de consenso.

    1. Se existir casa sharp (Pinnacle) com os dois lados na mesma linha -> usa ela.
    2. Senão, mediana das probabilidades sem vig de todas as casas na mesma linha.
    """
    same_line = [p for p in prices if p.over and p.under and abs(p.line - line) < 1e-9]
    if not same_line:
        return None
    sharp = [p for p in same_line if p.is_sharp]
    pool = sharp or same_line
    probs = [devig_pair(p.over, p.under)[0 if side == "over" else 1] for p in pool]  # type: ignore[arg-type]
    return float(median(probs))


def consensus_line(prices: Iterable[BookPrice]) -> float | None:
    lines = [p.line for p in prices]
    if not lines:
        return None
    # linha mais cotada; empate -> mediana
    counts: dict[float, int] = {}
    for ln in lines:
        counts[ln] = counts.get(ln, 0) + 1
    top = max(counts.values())
    return float(median([ln for ln, c in counts.items() if c == top]))


def best_price(prices: Iterable[BookPrice], line: float, side: str) -> tuple[str, float] | None:
    cands = [
        (p.book, p.over if side == "over" else p.under)
        for p in prices
        if abs(p.line - line) < 1e-9 and (p.over if side == "over" else p.under)
    ]
    if not cands:
        return None
    return max(cands, key=lambda c: c[1])  # type: ignore[return-value]


def expected_value(prob: float, odds: float) -> float:
    """EV por unidade apostada. 0.05 = +5%."""
    return prob * odds - 1.0


def kelly_fraction(prob: float, odds: float, fraction: float = 0.25) -> float:
    """Kelly fracionado (padrão 1/4) — nunca negativo."""
    b = odds - 1.0
    if b <= 0:
        return 0.0
    k = (prob * b - (1 - prob)) / b
    return max(0.0, k * fraction)
