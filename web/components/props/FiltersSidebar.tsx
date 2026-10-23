"use client";

import { useState } from "react";
import clsx from "clsx";
import { ChevronDown, RefreshCw, Search } from "lucide-react";

type SortKey = "confidence" | "ev" | "l10" | "time" | "score";
type HomeAway = "all" | "home" | "away";
type Period = "all" | "today" | "tomorrow";

/** Sidebar direita "Filtros" (igual ao painel do PropsBR): busca, confiança,
 * toggles e as seções colapsáveis Localização / Período. */
export function FiltersSidebar(props: {
  query: string;
  onQuery: (v: string) => void;
  minConf: number;
  onMinConf: (v: number) => void;
  evOnly: boolean;
  onEvOnly: (v: boolean) => void;
  evLocked?: boolean;
  bothSides: boolean;
  onBothSides: (v: boolean) => void;
  homeAway: HomeAway;
  onHomeAway: (v: HomeAway) => void;
  period: Period;
  onPeriod: (v: Period) => void;
  sort: SortKey;
  onSort: (v: SortKey) => void;
  loading: boolean;
  updatedAt: Date | null;
  onReload: () => void;
}) {
  return (
    <aside className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3.5 lg:sticky lg:top-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-wide text-slate-300">Filtros</h2>
        <button
          onClick={props.onReload}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200"
          title="Atualiza sozinho via tempo real"
        >
          <RefreshCw className={clsx("h-3.5 w-3.5", props.loading && "animate-spin")} />
          {props.updatedAt ? props.updatedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "…"}
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input
          value={props.query}
          onChange={(e) => props.onQuery(e.target.value)}
          placeholder="Buscar jogador ou time…"
          className="w-full rounded-lg border border-line bg-bg py-2 pl-9 pr-3 text-sm outline-none focus:border-brand-400"
        />
      </div>

      <label className="flex items-center justify-between gap-2 text-sm text-slate-300">
        <span>Confiança ≥ <b className="tabular-nums">{props.minConf}%</b></span>
        <input
          type="range" min={0} max={90} step={5} value={props.minConf}
          onChange={(e) => props.onMinConf(Number(e.target.value))}
          className="accent-brand-400"
        />
      </label>

      <div className="flex flex-col gap-2 border-t border-line pt-3">
        <Toggle checked={props.evOnly} onChange={props.onEvOnly} label="Só EV+" disabled={props.evLocked} />
        <Toggle checked={props.bothSides} onChange={props.onBothSides} label="Mostrar Mais/Menos" />
      </div>

      <Section title="Localização" defaultOpen>
        <div className="flex overflow-hidden rounded-lg border border-line text-xs">
          {([["all", "Todos"], ["home", "Casa"], ["away", "Fora"]] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => props.onHomeAway(v)}
              className={clsx(
                "flex-1 px-2.5 py-2 font-medium transition",
                props.homeAway === v ? "bg-brand-500/15 text-brand-200" : "text-slate-400 hover:bg-white/5",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Período" defaultOpen>
        <div className="grid grid-cols-3 gap-1.5">
          {([["all", "Qualquer"], ["today", "Hoje"], ["tomorrow", "Amanhã"]] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => props.onPeriod(v)}
              className={clsx(
                "rounded-lg border px-2 py-2 text-[11px] font-semibold transition",
                props.period === v ? "border-brand-400 bg-brand-500/15 text-brand-200" : "border-line text-slate-300 hover:border-slate-500",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Ordenar" defaultOpen>
        <select
          value={props.sort}
          onChange={(e) => props.onSort(e.target.value as SortKey)}
          className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-brand-400"
          aria-label="Ordenar"
        >
          <option value="confidence">Maior confiança</option>
          <option value="ev">Maior EV</option>
          <option value="l10">Melhor L10</option>
          <option value="time">Horário</option>
        </select>
      </Section>
    </aside>
  );
}

function Section({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="border-t border-line pt-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-xs font-bold uppercase tracking-wide text-slate-300"
      >
        {title}
        <ChevronDown className={clsx("h-3.5 w-3.5 text-slate-500 transition", open && "rotate-180")} />
      </button>
      {open && <div className="mt-2.5">{children}</div>}
    </div>
  );
}

function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      title={disabled ? "Recurso Pro" : undefined}
      className={clsx("flex items-center justify-between gap-2 text-sm", disabled ? "cursor-not-allowed text-slate-600" : "text-slate-300")}
    >
      {label}
      <span className={clsx("relative h-5 w-9 shrink-0 rounded-full transition", checked ? "bg-brand-500" : "bg-white/10")}>
        <span className={clsx("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all", checked ? "left-[18px]" : "left-0.5")} />
      </span>
    </button>
  );
}
