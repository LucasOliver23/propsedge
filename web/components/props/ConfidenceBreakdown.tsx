import clsx from "clsx";
import { confidenceTone, hitRate } from "@/lib/format";
import type { PropRow } from "@/lib/types";

/**
 * Espelha os pesos e a fórmula de workers/engine/confidence.py.
 * Se os pesos ou a sensibilidade de DvP mudarem lá, atualizar aqui também.
 */
const WEIGHTS = { l5: 0.1, l10: 0.3, l20: 0.1, h2h: 0.15, dvp: 0.2, proj: 0.15 };
const DVP_SENSITIVITY = 1.5;
const DVP_MAX_SHIFT = 0.25;

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

/** Verde ≥60%, âmbar ≥45%, vermelho abaixo (mesmos cortes do ConfidenceBar). */
function barTone(p: number) {
  if (p >= 0.6) return { bar: "bg-emerald-400", text: "text-emerald-300" };
  if (p >= 0.45) return { bar: "bg-amber-400", text: "text-amber-300" };
  return { bar: "bg-rose-500", text: "text-rose-400" };
}

function FactorRow({
  label,
  weight,
  p,
  fraction,
}: {
  label: string;
  weight: number;
  p: number | null;
  fraction?: string;
}) {
  if (p == null) {
    return (
      <div className="flex items-center gap-3 opacity-40">
        <span className="w-28 shrink-0 text-xs text-slate-400">{label}</span>
        <div className="h-2 flex-1 rounded-full bg-white/5" />
        <span className="w-20 shrink-0 text-right text-xs text-slate-600">sem dado</span>
      </div>
    );
  }
  const tone = barTone(p);
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-xs text-slate-400">{label}</span>
      <div
        className="relative h-2 flex-1 overflow-hidden rounded-full bg-white/10"
        role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)} aria-label={label}
      >
        <span className="absolute inset-y-0 left-1/2 w-px bg-white/20" />
        <span className={clsx("block h-full rounded-full transition-[width] duration-500", tone.bar)} style={{ width: `${Math.round(p * 100)}%` }} />
      </div>
      <span className={clsx("w-20 shrink-0 text-right font-display text-xs font-semibold tabular-nums", tone.text)}>
        {fraction ?? `${Math.round(p * 100)}%`}
      </span>
      <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-slate-600" title="Peso no score final">
        {Math.round(weight * 100)}%
      </span>
    </div>
  );
}

function Group({ title, score, children }: { title: string; score: number | null; children: React.ReactNode }) {
  return (
    <div className="space-y-2 rounded-lg border border-line/60 bg-bg/30 p-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</p>
        {score != null && (
          <span className={clsx("font-display text-xs font-bold tabular-nums", barTone(score).text)}>{Math.round(score * 100)}%</span>
        )}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

export function ConfidenceBreakdown({ row }: { row: PropRow }) {
  const l5 = hitRate(row.l5_hits, row.l5_n);
  const l10 = hitRate(row.l10_hits, row.l10_n);
  const l20 = hitRate(row.l20_hits, row.l20_n);
  const h2h = hitRate(row.h2h_hits, row.h2h_n);

  const dvp =
    row.dvp_factor == null
      ? null
      : clamp(0.5 + (row.side === "over" ? 1 : -1) * clamp((row.dvp_factor - 1) * DVP_SENSITIVITY, -DVP_MAX_SHIFT, DVP_MAX_SHIFT), 0, 1);

  // Aproximação visual (o motor usa Poisson/Normal com desvio padrão, que não chega ao front):
  // aqui só convertemos a distância entre a projeção e a linha em uma barra de 0 a 100%.
  const proj =
    row.proj_mean == null || !row.line
      ? null
      : clamp(0.5 + (row.side === "over" ? 1 : -1) * ((row.proj_mean - row.line) / row.line) * 2, 0, 1);

  const forma = [l5, l10, l20].filter((v): v is number => v != null);
  const formaScore = forma.length ? forma.reduce((a, b) => a + b, 0) / forma.length : null;

  const tone = confidenceTone(row.confidence);

  return (
    <div className="space-y-3 rounded-xl border border-line bg-bg/40 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-100">Como chegamos nesse score</p>
        <span className={clsx("rounded-full bg-white/5 px-2.5 py-0.5 font-display text-sm font-bold tabular-nums", tone.text)}>
          {row.confidence}%
        </span>
      </div>

      <Group title="Forma recente · 50% do peso" score={formaScore}>
        <FactorRow label="Últimos 5" weight={WEIGHTS.l5} p={l5} fraction={row.l5_n ? `${row.l5_hits}/${row.l5_n}` : undefined} />
        <FactorRow label="Últimos 10" weight={WEIGHTS.l10} p={l10} fraction={row.l10_n ? `${row.l10_hits}/${row.l10_n}` : undefined} />
        <FactorRow label="Últimos 20" weight={WEIGHTS.l20} p={l20} fraction={row.l20_n ? `${row.l20_hits}/${row.l20_n}` : undefined} />
      </Group>

      <Group title="Confronto direto · 15% do peso" score={h2h}>
        <FactorRow label="H2H" weight={WEIGHTS.h2h} p={h2h} fraction={row.h2h_n ? `${row.h2h_hits}/${row.h2h_n}` : undefined} />
      </Group>

      <Group title="Matchup · 20% do peso" score={dvp}>
        <FactorRow
          label="Defesa vs posição"
          weight={WEIGHTS.dvp}
          p={dvp}
          fraction={row.dvp_rank ? `${row.dvp_rank}º melhor defesa` : undefined}
        />
      </Group>

      <Group title="Projeção · 15% do peso" score={proj}>
        <FactorRow
          label="Média proj. vs linha"
          weight={WEIGHTS.proj}
          p={proj}
          fraction={row.proj_mean != null ? `${row.proj_mean.toFixed(1)} proj.` : undefined}
        />
      </Group>

      <p className="text-[11px] leading-relaxed text-slate-500">
        O % à direita de cada barra é a chance que esse fator sozinho dá pro lado {row.side === "over" ? "Mais" : "Menos"}; o número
        menor é o peso desse fator no score final de {row.confidence}%. Abaixo de 45% o fator pesa contra essa aposta.
      </p>
    </div>
  );
}
