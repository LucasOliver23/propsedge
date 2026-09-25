import clsx from "clsx";
import type { Side } from "@/lib/types";

interface Props {
  values: number[];     // mais antigo -> mais recente
  opponents?: string[];
  line: number;
  side: Side;
}

/** Barras do histórico L10 com a linha da prop sobreposta. Verde = teria batido o lado escolhido. */
export function L10Chart({ values, opponents = [], line, side }: Props) {
  if (!values.length) {
    return <p className="text-sm text-slate-400">Sem histórico suficiente.</p>;
  }
  const max = Math.max(...values, line) * 1.15 || 1;
  const linePos = (line / max) * 100;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
        <span>Últimos {values.length} jogos</span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-px w-4 border-t border-dashed border-sky-300" /> Linha {line}
        </span>
      </div>
      <div className="relative h-36">
        <div
          className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-sky-300/80"
          style={{ bottom: `${linePos}%` }}
        />
        <div className="flex h-full items-end gap-1.5">
          {values.map((v, i) => {
            const hit = v === line ? null : side === "over" ? v > line : v < line;
            return (
              <div key={i} className="group flex h-full flex-1 flex-col items-center justify-end">
                <span className="mb-1 text-[11px] font-medium tabular-nums text-slate-200">{v}</span>
                <div
                  className={clsx(
                    "w-full rounded-t-md transition-all duration-500",
                    hit === null ? "bg-slate-500" : hit ? "bg-emerald-500/90" : "bg-rose-500/80",
                  )}
                  style={{ height: `${Math.max((v / max) * 100, 2)}%` }}
                  title={`${opponents[i] ? `vs ${opponents[i]}: ` : ""}${v}`}
                />
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-1 flex gap-1.5">
        {values.map((_, i) => (
          <span key={i} className="flex-1 truncate text-center text-[10px] text-slate-500">
            {opponents[i] ?? ""}
          </span>
        ))}
      </div>
    </div>
  );
}
