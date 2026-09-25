import clsx from "clsx";
import { confidenceTone } from "@/lib/format";

export function ConfidenceBar({ value, compact = false }: { value: number; compact?: boolean }) {
  const tone = confidenceTone(value);
  return (
    <div className="flex items-center gap-2" title={`Confiança ${value}%`}>
      <div
        className={clsx("relative h-2 overflow-hidden rounded-full bg-white/10", compact ? "w-16" : "w-24")}
        role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-label="Confiança"
      >
        {/* marcador de 50% (sem vantagem) */}
        <span className="absolute inset-y-0 left-1/2 w-px bg-white/25" />
        <span
          className={clsx("block h-full rounded-full transition-[width] duration-500", tone.bar)}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className={clsx("w-9 text-right text-sm font-semibold tabular-nums", tone.text)}>{value}%</span>
    </div>
  );
}
