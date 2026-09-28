"use client";

import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Flame, RefreshCw, Search, SlidersHorizontal, Target, Wallet } from "lucide-react";
import { usePropsBoard } from "@/hooks/usePropsBoard";
import { useTrackedBets } from "@/hooks/useTrackedBets";
import { SPORTS } from "@/lib/constants";
import { brl } from "@/lib/format";
import type { PropRow, Side, SportId } from "@/lib/types";
import { GRID, PropRowItem } from "./PropRowItem";

type SortKey = "confidence" | "ev" | "l10" | "time";
const PAGE = 60;

export function PropsDashboard({ initialRows = [] }: { initialRows?: PropRow[] }) {
  const router = useRouter();
  const { rows, loading, error, updatedAt, reload } = usePropsBoard(initialRows);
  const { user, profile, pinned, track, trackModel } = useTrackedBets();

  // ---------------------------------------------------------------- filtros
  const [sport, setSport] = useState<SportId | "all">("all");
  const [stat, setStat] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [minConf, setMinConf] = useState(0);
  const [evOnly, setEvOnly] = useState(false);
  const [bothSides, setBothSides] = useState(false);
  const [sort, setSort] = useState<SortKey>("confidence");
  const [limit, setLimit] = useState(PAGE);
  const [expanded, setExpanded] = useState<string | null>(null);
  const search = useDeferredValue(query.trim().toLowerCase());

  // Por padrão mostramos só o lado mais forte de cada mercado
  const base = useMemo(() => {
    if (bothSides) return rows;
    const best = new Map<number, PropRow>();
    for (const r of rows) {
      const cur = best.get(r.market_id);
      if (!cur || r.confidence > cur.confidence) best.set(r.market_id, r);
    }
    return Array.from(best.values());
  }, [rows, bothSides]);

  const sportCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of base) c[r.sport_id] = (c[r.sport_id] ?? 0) + 1;
    return c;
  }, [base]);

  const statOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of base) if (sport === "all" || r.sport_id === sport) m.set(r.stat_key, r.stat_label ?? r.stat_key);
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [base, sport]);

  const filtered = useMemo(() => {
    const out = base.filter(
      (r) =>
        (sport === "all" || r.sport_id === sport) &&
        (stat === "all" || r.stat_key === stat) &&
        r.confidence >= minConf &&
        (!evOnly || (r.ev ?? -1) >= 0.03) &&
        (!search ||
          r.player_name.toLowerCase().includes(search) ||
          r.team_abbr?.toLowerCase().includes(search) ||
          r.opp_abbr?.toLowerCase().includes(search)),
    );
    const l10 = (r: PropRow) => (r.l10_n ? (r.l10_hits ?? 0) / r.l10_n : -1);
    const sorters: Record<SortKey, (a: PropRow, b: PropRow) => number> = {
      confidence: (a, b) => b.confidence - a.confidence,
      ev: (a, b) => (b.ev ?? -9) - (a.ev ?? -9),
      l10: (a, b) => l10(b) - l10(a),
      time: (a, b) => +new Date(a.start_time) - +new Date(b.start_time),
    };
    return out.sort(sorters[sort]);
  }, [base, sport, stat, minConf, evOnly, search, sort]);

  const evCount = useMemo(() => base.filter((r) => (r.ev ?? -1) >= 0.03).length, [base]);
  const modelCount = useMemo(() => base.filter((r) => r.line_source === "model").length, [base]);
  const isPremium = profile ? profile.plan !== "free" : false;

  const handlePin = useCallback(
    async (marketId: number, side: Side, stake: number, model: boolean) => {
      if (!user) {
        router.push("/login?next=/props");
        throw new Error("Entre na sua conta para fixar props.");
      }
      if (model) await trackModel(marketId, side, stake);   // sem odd de casa: odd justa do modelo
      else await track(marketId, side, stake);
    },
    [user, router, track, trackModel],
  );

  // ---------------------------------------------------------------- render
  return (
    <div className="mx-auto max-w-[1400px] space-y-5 px-4 py-6">
      {/* KPIs */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={<Target className="h-4 w-4" />} label="Props hoje" value={base.length.toLocaleString("pt-BR")} />
        <Kpi
          icon={<Flame className="h-4 w-4" />}
          label="Alertas EV+"
          value={isPremium ? String(evCount) : "Pro"}
          tone="text-emerald-300"
        />
        <Kpi
          icon={<SlidersHorizontal className="h-4 w-4" />}
          label="Confiança ≥ 70%"
          value={String(base.filter((r) => r.confidence >= 70).length)}
        />
        <Kpi
          icon={<Wallet className="h-4 w-4" />}
          label="Bankroll virtual"
          value={profile ? brl(Number(profile.bankroll)) : "—"}
        />
      </section>

      {modelCount > 0 && (
        <p className="rounded-xl border border-sky-500/20 bg-sky-500/5 px-4 py-2.5 text-xs text-sky-200">
          <b>{modelCount}</b> props estão com <b>linha do modelo</b> (sem odd de casa no momento): a linha é a que o PropsEdge
          calcula como ~50/50 e a odd mostrada é a <b>odd justa</b>. Compare com a odd da sua casa antes de entrar.
        </p>
      )}

      {/* Esportes */}
      <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" aria-label="Esportes">
        <SportChip active={sport === "all"} onClick={() => { setSport("all"); setStat("all"); }} label="Todos" count={base.length} />
        {SPORTS.map((s) => (
          <SportChip
            key={s.id}
            active={sport === s.id}
            onClick={() => { setSport(s.id); setStat("all"); setLimit(PAGE); }}
            label={`${s.emoji} ${s.label}`}
            count={sportCounts[s.id] ?? 0}
          />
        ))}
      </nav>

      {/* Filtros rápidos */}
      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar jogador ou time…"
            className="w-full rounded-lg border border-line bg-bg py-2 pl-9 pr-3 text-sm outline-none focus:border-sky-400"
          />
        </div>

        <select
          value={stat}
          onChange={(e) => setStat(e.target.value)}
          className="rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-sky-400"
          aria-label="Mercado"
        >
          <option value="all">Todos os mercados</option>
          {statOptions.map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>

        <label className="flex items-center gap-2 text-sm text-slate-300">
          Confiança ≥ <b className="w-8 tabular-nums">{minConf}%</b>
          <input
            type="range" min={0} max={90} step={5} value={minConf}
            onChange={(e) => setMinConf(Number(e.target.value))}
            className="accent-sky-400"
          />
        </label>

        <Toggle checked={evOnly} onChange={setEvOnly} label="Só EV+" disabled={!isPremium} />
        <Toggle checked={bothSides} onChange={setBothSides} label="Mostrar Mais/Menos" />

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-sky-400"
          aria-label="Ordenar"
        >
          <option value="confidence">Maior confiança</option>
          <option value="ev">Maior EV</option>
          <option value="l10">Melhor L10</option>
          <option value="time">Horário</option>
        </select>

        <button
          onClick={reload}
          className="ml-auto flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200"
          title="Atualiza sozinho via tempo real"
        >
          <RefreshCw className={clsx("h-3.5 w-3.5", loading && "animate-spin")} />
          {updatedAt ? updatedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "…"}
        </button>
      </section>

      {/* Tabela */}
      <section className="overflow-visible rounded-xl border border-line bg-surface">
        <div className={clsx(GRID, "hidden border-b border-line px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 md:grid")}>
          <span>Jogador</span>
          <span>Prop</span>
          <span className="text-center">L5</span>
          <span className="text-center">L10</span>
          <span className="text-center">L20</span>
          <span className="text-center">H2H</span>
          <span className="text-center" title="Ranking da defesa adversária vs posição">DvP</span>
          <span>Confiança</span>
          <span className="text-right">Melhor odd</span>
          <span className="text-right">EV</span>
          <span />
          <span />
        </div>

        {error && <p className="p-6 text-sm text-rose-300">Erro ao carregar: {error}</p>}
        {loading && !rows.length && <SkeletonRows />}
        {!loading && !filtered.length && (
          <p className="p-10 text-center text-sm text-slate-400">
            {rows.length ? "Nenhuma prop com esses filtros." : "Nenhuma prop para as próximas 36h ainda — as props são geradas a cada 15 min conforme a agenda."}
          </p>
        )}

        <ul>
          {filtered.slice(0, limit).map((r) => {
            const key = `${r.market_id}:${r.side}`;
            return (
              <PropRowItem
                key={key}
                row={r}
                expanded={expanded === key}
                pinned={pinned.has(key)}
                defaultStake={Number(profile?.unit_size ?? 10)}
                onToggle={() => setExpanded((e) => (e === key ? null : key))}
                onPin={(stake) => handlePin(r.market_id, r.side, stake, r.line_source === "model")}
              />
            );
          })}
        </ul>

        {filtered.length > limit && (
          <button
            onClick={() => setLimit((l) => l + PAGE)}
            className="w-full border-t border-line py-3 text-sm text-sky-300 hover:bg-white/[0.03]"
          >
            Carregar mais ({filtered.length - limit} restantes)
          </button>
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ UI local
function Kpi({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="flex items-center gap-1.5 text-xs text-slate-400">{icon}{label}</p>
      <p className={clsx("mt-1 text-2xl font-bold tabular-nums", tone ?? "text-slate-100")}>{value}</p>
    </div>
  );
}

function SportChip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition",
        active ? "border-sky-400 bg-sky-500/15 text-sky-200" : "border-line text-slate-300 hover:border-slate-500",
      )}
    >
      {label}
      <span className={clsx("rounded-full px-1.5 text-[11px] tabular-nums", active ? "bg-sky-400/20" : "bg-white/5 text-slate-500")}>
        {count}
      </span>
    </button>
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
      className={clsx("flex items-center gap-2 text-sm", disabled ? "cursor-not-allowed text-slate-600" : "text-slate-300")}
    >
      <span className={clsx("relative h-5 w-9 rounded-full transition", checked ? "bg-sky-500" : "bg-white/10")}>
        <span className={clsx("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all", checked ? "left-[18px]" : "left-0.5")} />
      </span>
      {label}
    </button>
  );
}

function SkeletonRows() {
  return (
    <ul className="animate-pulse">
      {Array.from({ length: 8 }).map((_, i) => (
        <li key={i} className="flex items-center gap-4 border-b border-line/70 px-4 py-4">
          <div className="h-10 w-10 rounded-full bg-white/5" />
          <div className="h-3 w-40 rounded bg-white/5" />
          <div className="ml-auto h-3 w-24 rounded bg-white/5" />
        </li>
      ))}
    </ul>
  );
}
