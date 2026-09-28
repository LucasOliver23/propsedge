import clsx from "clsx";
import type { SeriesPoint, Side } from "@/lib/types";

/** Anel de score 0-100 */
export function ScoreRing({ value, size = 56, sub }: { value: number; size?: number; sub?: string }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const color = value >= 70 ? "#34d399" : value >= 55 ? "#22c55e" : value >= 45 ? "#fbbf24" : "#f43f5e";
  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} className="-rotate-90" aria-label={`Score ${value}`}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,.1)" strokeWidth={5} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={5} fill="none" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} className="transition-all duration-500" />
        <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fill="#f1f5f9"
          fontSize={size * 0.32} fontWeight={700} transform={`rotate(90 ${size / 2} ${size / 2})`}>{value}</text>
      </svg>
      {sub && <span className="mt-1 text-[11px] text-slate-400">{sub}</span>}
    </div>
  );
}

const GRADE_TONE: Record<string, string> = {
  A: "border-emerald-400 text-emerald-300", B: "border-green-500 text-green-400",
  C: "border-amber-400 text-amber-300", D: "border-orange-500 text-orange-400", F: "border-rose-500 text-rose-400",
};
const GRADE_TEXT: Record<string, string> = { A: "favorável", B: "favorável", C: "neutro", D: "difícil", F: "difícil" };

export function GradeBadge({ grade, size = 56 }: { grade: string | null; size?: number }) {
  if (!grade) return <span className="text-xs text-slate-500">—</span>;
  return (
    <div className="flex flex-col items-center">
      <span className={clsx("flex items-center justify-center rounded-full border-[3px] font-black", GRADE_TONE[grade])}
        style={{ width: size, height: size, fontSize: size * 0.4 }}>{grade}</span>
      <span className="mt-1 text-[11px] text-slate-400">{GRADE_TEXT[grade]}</span>
    </div>
  );
}

/** Barras do histórico com a linha da aposta; verde = bateu o lado escolhido */
export function SeriesChart({ points, line, side }: { points: SeriesPoint[]; line: number; side: Side }) {
  if (!points.length) return <p className="py-10 text-center text-sm text-slate-500">Sem jogos nessa janela.</p>;
  const pts = [...points].reverse(); // antigo -> recente
  const max = Math.max(...pts.map((p) => p.v), line) * 1.15 || 1;
  return (
    <div>
      <div className="relative h-48">
        <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-white/60" style={{ bottom: `${(line / max) * 100}%` }}>
          <span className="absolute -top-3 left-0 rounded bg-slate-900 px-1.5 text-xs font-bold text-white ring-1 ring-white/40">{line}</span>
        </div>
        <div className="flex h-full items-end gap-1.5 pl-9">
          {pts.map((p, i) => {
            const ok = p.v === line ? null : (p.v > line) === (side === "over");
            return (
              <div key={i} className="flex h-full flex-1 flex-col justify-end" title={`${p.o} · ${p.v}`}>
                <div className={clsx("flex w-full items-end justify-center rounded-t-md pb-1 text-xs font-bold text-white transition-all duration-500",
                  ok === null ? "bg-slate-500" : ok ? "bg-emerald-500" : "bg-rose-500")}
                  style={{ height: `${Math.max((p.v / max) * 100, 8)}%` }}>{p.v}</div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-1 flex gap-1.5 pl-9">
        {pts.map((p, i) => (
          <div key={i} className="flex-1 text-center leading-tight">
            <p className="text-[10px] text-slate-300">{new Date(p.d + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</p>
            <p className="truncate text-[10px] text-slate-500">{p.h ? "🏠" : "✈️"} {p.o}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TeamLogo({ src, alt, size = 40 }: { src: string | null; alt: string; size?: number }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} width={size} height={size} className="shrink-0 object-contain" loading="lazy" />
  ) : (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-elevated text-xs font-bold text-slate-400"
      style={{ width: size, height: size }}>{alt.slice(0, 3).toUpperCase()}</span>
  );
}
