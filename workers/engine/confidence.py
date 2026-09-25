"""
Confidence Score (0-100%) de uma player prop.

Componentes (cada um vira uma probabilidade de acerto p_i para o lado escolhido):

    componente        peso   o que mede
    ---------------   -----  -----------------------------------------------------------
    L10 hit rate      0.30   forma recente (principal sinal)
    DvP               0.20   quanto o adversário cede para a posição do jogador
    H2H               0.15   histórico contra o mesmo adversário
    Projeção          0.15   distribuição (Poisson/Normal) da média ponderada x ajuste DvP
    L5 hit rate       0.10   momento imediato
    L20 hit rate      0.10   estabilidade / regressão à média

1) Hit rates usam encolhimento Bayesiano (Beta prior) em direção à prob. do mercado:
       p = (acertos + a * prior) / (n + a)
   Isso impede que "5/5" com amostra minúscula vire 100%.

2) model_prob = soma(w_i * p_i) / soma(w_i)   (componentes sem dados saem e os pesos se redistribuem)

3) Confiabilidade R em [0.5, 1]:
       R = 0.5 + 0.5 * fator_amostra * consistência
       fator_amostra = min(1, jogos_L20 / 15)
       consistência  = clamp(1 - 2 * desvio_padrão(p_i), 0.4, 1)   (componentes discordando -> menos confiança)

4) confidence = 100 * (0.5 + (model_prob - 0.5) * R)
   => 50 = sem vantagem; >65 = sinal forte; <40 = o outro lado é mais provável.

5) EV: fair_prob = 0.65 * prob_mercado_sem_vig + 0.35 * model_prob  (mercado sharp pesa mais)
       ev = fair_prob * melhor_odd - 1
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from statistics import mean, pstdev
from typing import Sequence

WEIGHTS: dict[str, float] = {
    "l10": 0.30,
    "dvp": 0.20,
    "h2h": 0.15,
    "proj": 0.15,
    "l5": 0.10,
    "l20": 0.10,
}

PRIOR_STRENGTH = 4.0      # "a" do Beta prior nos hit rates
H2H_PRIOR_STRENGTH = 3.0
DVP_SENSITIVITY = 1.5     # fator 1.10 (cede 10% acima da média) -> +0.15 de prob
DVP_MAX_SHIFT = 0.25
MARKET_BLEND = 0.65
POISSON_MEAN_THRESHOLD = 8.0  # abaixo disso a estatística é "contagem" (chutes, aces, rebotes baixos)


@dataclass
class PropInput:
    line: float
    side: str                              # 'over' | 'under'
    recent_values: Sequence[float]         # mais recente primeiro, só jogos em que atuou (até 20)
    h2h_values: Sequence[float] = ()
    dvp_factor: float | None = None        # allowed_avg / league_avg
    market_prob: float | None = None       # prob. sem vig do lado
    best_odds: float | None = None


@dataclass
class PropResult:
    confidence: int
    model_prob: float
    fair_prob: float | None
    ev: float | None
    proj_mean: float | None
    components: dict[str, float] = field(default_factory=dict)
    hits: dict[str, tuple[int, int]] = field(default_factory=dict)  # 'l10' -> (acertos, n)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def _hit(value: float, line: float, side: str) -> float:
    if value == line:
        return 0.5  # push conta como meio acerto
    return 1.0 if (value > line) == (side == "over") else 0.0


def hit_count(values: Sequence[float], line: float, side: str) -> tuple[float, int]:
    return sum(_hit(v, line, side) for v in values), len(values)


def shrunk_rate(hits: float, n: int, prior: float, strength: float) -> float:
    return (hits + strength * prior) / (n + strength)


def ewma(values: Sequence[float], half_life: float = 5.0) -> float:
    """Média exponencial (values[0] = jogo mais recente)."""
    decay = 0.5 ** (1 / half_life)
    w = [decay**i for i in range(len(values))]
    return sum(v * wi for v, wi in zip(values, w)) / sum(w)


def _poisson_cdf(k: int, lam: float) -> float:
    if k < 0:
        return 0.0
    term = math.exp(-lam)
    total = term
    for i in range(1, k + 1):
        term *= lam / i
        total += term
    return min(1.0, total)


def _normal_cdf(x: float, mu: float, sd: float) -> float:
    return 0.5 * (1 + math.erf((x - mu) / (sd * math.sqrt(2))))


def projection_prob(mu: float, sd: float, line: float, side: str) -> float:
    """P(acerto) pela distribuição. Linhas .5 não têm push; inteiras têm."""
    if mu <= 0:
        return 0.0 if side == "over" else 1.0
    if mu < POISSON_MEAN_THRESHOLD:
        p_le = _poisson_cdf(math.floor(line), mu)
        p_push = (_poisson_cdf(int(line), mu) - _poisson_cdf(int(line) - 1, mu)) if line.is_integer() else 0.0
        p_over = 1 - p_le
        p_under = p_le - p_push
    else:
        sd = max(sd, 0.15 * mu, 1.0)
        # correção de continuidade p/ estatísticas discretas
        p_over = 1 - _normal_cdf(math.floor(line) + 0.5, mu, sd)
        p_under = _normal_cdf(math.ceil(line) - 0.5, mu, sd)
        p_push = max(0.0, 1 - p_over - p_under)
    raw = p_over if side == "over" else p_under
    return raw + 0.5 * p_push


def dvp_prob(dvp_factor: float, side: str) -> float:
    shift = _clamp((dvp_factor - 1.0) * DVP_SENSITIVITY, -DVP_MAX_SHIFT, DVP_MAX_SHIFT)
    return 0.5 + shift if side == "over" else 0.5 - shift


# ---------------------------------------------------------------------------
# principal
# ---------------------------------------------------------------------------
def compute_confidence(inp: PropInput) -> PropResult:
    side, line = inp.side, inp.line
    prior = inp.market_prob if inp.market_prob is not None else 0.5
    recent = list(inp.recent_values)[:20]

    comps: dict[str, float] = {}
    hits: dict[str, tuple[int, int]] = {}

    for key, n in (("l5", 5), ("l10", 10), ("l20", 20)):
        window = recent[:n]
        if window:
            h, cnt = hit_count(window, line, side)
            comps[key] = shrunk_rate(h, cnt, prior, PRIOR_STRENGTH)
            hits[key] = (int(round(h)), cnt)

    if inp.h2h_values:
        h, cnt = hit_count(inp.h2h_values, line, side)
        comps["h2h"] = shrunk_rate(h, cnt, prior, H2H_PRIOR_STRENGTH)
        hits["h2h"] = (int(round(h)), cnt)

    if inp.dvp_factor is not None:
        comps["dvp"] = dvp_prob(inp.dvp_factor, side)

    proj_mean = None
    if len(recent) >= 3:
        adj = _clamp(1 + ((inp.dvp_factor or 1.0) - 1) * 0.5, 0.85, 1.15)
        proj_mean = ewma(recent) * adj
        sd = pstdev(recent) if len(recent) > 1 else proj_mean * 0.3
        comps["proj"] = projection_prob(proj_mean, sd, line, side)

    if not comps:
        return PropResult(confidence=50, model_prob=prior, fair_prob=inp.market_prob, ev=None, proj_mean=None)

    wsum = sum(WEIGHTS[k] for k in comps)
    model_prob = sum(WEIGHTS[k] * p for k, p in comps.items()) / wsum

    sample_factor = min(1.0, len(recent) / 15)
    consistency = _clamp(1 - 2 * pstdev(comps.values()), 0.4, 1.0) if len(comps) > 1 else 0.6
    reliability = 0.5 + 0.5 * sample_factor * consistency
    confidence = round(_clamp(100 * (0.5 + (model_prob - 0.5) * reliability), 0, 100))

    fair = None
    ev = None
    if inp.market_prob is not None:
        fair = MARKET_BLEND * inp.market_prob + (1 - MARKET_BLEND) * model_prob
    elif inp.best_odds:
        fair = model_prob
    if fair is not None and inp.best_odds:
        ev = fair * inp.best_odds - 1

    return PropResult(
        confidence=int(confidence),
        model_prob=round(model_prob, 4),
        fair_prob=round(fair, 4) if fair is not None else None,
        ev=round(ev, 4) if ev is not None else None,
        proj_mean=round(proj_mean, 2) if proj_mean is not None else None,
        components={k: round(v, 4) for k, v in comps.items()},
        hits=hits,
    )


def is_ev_alert(res: PropResult, best_odds: float | None, min_ev: float = 0.03, min_conf: int = 55) -> bool:
    """Alerta EV+ só quando mercado E modelo concordam que a odd está alta."""
    if res.ev is None or not best_odds:
        return False
    return res.ev >= min_ev and res.confidence >= min_conf and res.model_prob > 1 / best_odds


if __name__ == "__main__":  # exemplo rápido: python -m engine.confidence
    r = compute_confidence(PropInput(
        line=24.5, side="over",
        recent_values=[31, 28, 22, 27, 30, 25, 19, 29, 33, 26, 21, 24, 28, 30, 18, 27, 25, 29, 31, 23],
        h2h_values=[29, 26, 31], dvp_factor=1.08, market_prob=0.54, best_odds=1.95,
    ))
    print(r)
    print("média L20:", round(mean([31, 28, 22, 27, 30, 25, 19, 29, 33, 26, 21, 24, 28, 30, 18, 27, 25, 29, 31, 23]), 2))
