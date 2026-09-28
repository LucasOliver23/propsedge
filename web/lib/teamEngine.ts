/**
 * Score de mercados de time/jogo — ESPELHO de workers/engine/team_score.py.
 * Roda no navegador para recalcular tudo quando o usuário muda a linha ou o lado.
 */
import type { Side, TeamSeries } from "./types";

export const WEIGHTS: Record<string, number> = {
  l10: 0.25, l5: 0.1, l20: 0.1, h2h: 0.15, venue: 0.1, season: 0.05, matchup: 0.1, proj: 0.15,
};
const PRIOR = 3;

export function hit(v: number, line: number, side: Side) {
  if (v === line) return 0.5;
  return (v > line) === (side === "over") ? 1 : 0;
}

export function hitRate(vals: number[], line: number, side: Side) {
  const hits = vals.reduce((s, v) => s + hit(v, line, side), 0);
  return { hits: Math.round(hits), n: vals.length, rate: vals.length ? hits / vals.length : null };
}

const shrink = (h: number, n: number) => (h + PRIOR * 0.5) / (n + PRIOR);

function poisCdf(k: number, lam: number) {
  if (k < 0) return 0;
  let term = Math.exp(-lam);
  let total = term;
  for (let i = 1; i <= k; i++) { term *= lam / i; total += term; }
  return Math.min(1, total);
}

function erf(x: number) {
  // Abramowitz-Stegun 7.1.26
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}

export function projProb(mu: number, sd: number, line: number, side: Side) {
  if (mu <= 0) return side === "over" ? 0 : 1;
  let pOver: number;
  if (mu < 8) pOver = 1 - poisCdf(Math.floor(line), mu);
  else {
    const s = Math.max(sd, 0.15 * mu, 1);
    pOver = 1 - 0.5 * (1 + erf((Math.floor(line) + 0.5 - mu) / (s * Math.SQRT2)));
  }
  return side === "over" ? pOver : 1 - pOver;
}

function pstdev(xs: number[]) {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

export function grade(factor: number | null | undefined, side: Side) {
  if (factor == null) return null;
  const f = side === "over" ? factor : 2 - factor;
  return f >= 1.15 ? "A" : f >= 1.05 ? "B" : f >= 0.95 ? "C" : f >= 0.85 ? "D" : "F";
}

export function teamScore(data: TeamSeries, line: number, side: Side, projection: number | null, factor: number | null) {
  const l20 = data.l20.map((p) => p.v);
  const windows: [string, number[]][] = [
    ["l5", l20.slice(0, 5)], ["l10", l20.slice(0, 10)], ["l20", l20.slice(0, 20)],
    ["h2h", data.h2h.map((p) => p.v)], ["venue", data.venue.map((p) => p.v)], ["season", data.season ?? []],
  ];
  const comps: Record<string, number> = {};
  for (const [k, w] of windows) {
    if (w.length) comps[k] = shrink(w.reduce((s, v) => s + hit(v, line, side), 0), w.length);
  }
  if (factor != null) {
    const shift = Math.max(-0.25, Math.min(0.25, (factor - 1) * 1.5));
    comps.matchup = side === "over" ? 0.5 + shift : 0.5 - shift;
  }
  if (projection != null && l20.length >= 3) comps.proj = projProb(projection, data.sd ?? pstdev(l20), line, side);
  const keys = Object.keys(comps);
  if (!keys.length) return { score: 50, prob: 0.5 };
  const wsum = keys.reduce((s, k) => s + WEIGHTS[k], 0);
  const p = keys.reduce((s, k) => s + WEIGHTS[k] * comps[k], 0) / wsum;
  const sample = Math.min(1, l20.length / 15);
  const consistency = keys.length > 1 ? Math.max(0.4, Math.min(1, 1 - 2 * pstdev(Object.values(comps)))) : 0.6;
  const r = 0.5 + 0.5 * sample * consistency;
  return { score: Math.round(Math.max(0, Math.min(100, 100 * (0.5 + (p - 0.5) * r)))), prob: p };
}

export const ev = (prob: number, odd: number) => prob * odd - 1;
