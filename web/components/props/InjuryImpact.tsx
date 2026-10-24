import clsx from "clsx";
import { ShieldAlert } from "lucide-react";
import type { TeammateInjury } from "@/lib/types";

/** Out/IL/suspenso pesa mais que Questionable/Day-To-Day. */
function isOut(status: string) {
  return /out|il|suspen|doubtful/i.test(status);
}

function InjuryRow({ inj }: { inj: TeammateInjury }) {
  const out = isOut(inj.status);
  return (
    <li
      className="flex items-center justify-between gap-2 rounded-md bg-white/[0.03] px-2 py-1 text-xs"
      title={inj.detail ?? undefined}
    >
      <span className="min-w-0 truncate text-slate-300">
        {inj.name}
        {inj.position && <span className="text-slate-500"> · {inj.position}</span>}
      </span>
      <span
        className={clsx(
          "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tabular-nums",
          out ? "bg-rose-500/15 text-rose-300" : "bg-amber-500/15 text-amber-300",
        )}
      >
        {inj.status}
      </span>
    </li>
  );
}

function Column({ title, injuries }: { title: string; injuries: TeammateInjury[] | null }) {
  if (!injuries || injuries.length === 0) {
    return (
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold font-display uppercase tracking-wide text-slate-500">{title}</p>
        <p className="mt-1.5 text-xs text-slate-600">Sem desfalques relevantes</p>
      </div>
    );
  }
  return (
    <div className="min-w-0 flex-1">
      <p className="text-[11px] font-semibold font-display uppercase tracking-wide text-slate-500">{title}</p>
      <ul className="mt-1.5 space-y-1">
        {injuries.slice(0, 5).map((inj) => (
          <InjuryRow key={inj.name} inj={inj} />
        ))}
      </ul>
    </div>
  );
}

/**
 * Desfalques do time do jogador e do adversário — contexto que pode mudar a
 * projeção (ex.: titular lesionado no time = mais minutos/volume pro jogador
 * analisado; defensor chave fora no adversário = matchup mais fácil).
 */
export function InjuryImpact({
  teamAbbr,
  oppAbbr,
  teamInjuries,
  oppInjuries,
}: {
  teamAbbr: string | null;
  oppAbbr: string | null;
  teamInjuries: TeammateInjury[] | null;
  oppInjuries: TeammateInjury[] | null;
}) {
  const hasAny = (teamInjuries?.length ?? 0) > 0 || (oppInjuries?.length ?? 0) > 0;
  if (!hasAny) return null;

  return (
    <div className="space-y-2 rounded-xl border border-line bg-bg/40 p-4">
      <div className="flex items-center gap-1.5">
        <ShieldAlert className="h-3.5 w-3.5 text-amber-300" />
        <p className="text-sm font-semibold text-slate-100">Impacto de lesões</p>
      </div>
      <div className="flex gap-4">
        <Column title={teamAbbr ?? "Time"} injuries={teamInjuries} />
        <Column title={oppAbbr ?? "Adversário"} injuries={oppInjuries} />
      </div>
    </div>
  );
}
