import clsx from "clsx";
import { hitRate } from "@/lib/format";

export function HitRate({ label, hits, n }: { label: string; hits: number | null; n: number | null }) {
  const r = hitRate(hits, n);
  const tone =
    r == null ? "text-slate-500" : r >= 0.7 ? "text-emerald-300" : r >= 0.5 ? "text-slate-200" : "text-rose-300";
  return (
    <div className="flex flex-col items-center leading-tight">
      <span className="text-[10px] uppercase tracking-wide text-slate-500">{label}</span>
      <span className={clsx("text-sm font-semibold tabular-nums", tone)}>
        {r == null ? "—" : `${Math.round(r * 100)}%`}
      </span>
      <span className="text-[10px] tabular-nums text-slate-500">{n ? `${hits}/${n}` : ""}</span>
    </div>
  );
}

export function DvpBadge({ rank, factor }: { rank: number | null; factor: number | null }) {
  if (rank == null || factor == null) return <span className="text-xs text-slate-500">—</span>;
  const soft = factor >= 1.05;
  const tough = factor <= 0.95;
  return (
    <span
      title={`Cede ${((factor - 1) * 100).toFixed(0)}% vs média da liga • rank ${rank} (1 = melhor defesa)`}
      className={clsx(
        "rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums",
        soft && "bg-emerald-500/15 text-emerald-300",
        tough && "bg-rose-500/15 text-rose-300",
        !soft && !tough && "bg-white/5 text-slate-300",
      )}
    >
      #{rank}
    </span>
  );
}
