"use client";

import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import {
  Flame,
  Layers,
  Rocket,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Target,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { usePropsBoard } from "@/hooks/usePropsBoard";
import { useTrackedBets } from "@/hooks/useTrackedBets";
import { SPORTS } from "@/lib/constants";
import { brDateKey, brl } from "@/lib/format";
import type { PropRow, Side, SportId } from "@/lib/types";
import { FiltersSidebar } from "./FiltersSidebar";
import { GamesSidebar } from "./GamesSidebar";
import { MultiplesBar } from "./MultiplesBar";
import { GRID, PropRowItem } from "./PropRowItem";

type SortKey = "confidence" | "ev" | "l10" | "time" | "score";
const PAGE = 60;

/** Score composto (estilo "Top Score" do PropsBR): mistura confiança, sequência
 * recente (L10) e vantagem (EV) num único número 0-100. É uma primeira versão —
 * os pesos abaixo podem ser ajustados depois de validar com o usuário. */
function propScore(r: PropRow): number {
  const l10 = r.l10_n ? (r.l10_hits ?? 0) / r.l10_n : 0.5;
  const evNorm = Math.max(0, Math.min(1, ((r.ev ?? 0) + 0.05) / 0.2));
  return r.confidence * 0.55 + l10 * 100 * 0.3 + evNorm * 100 * 0.15;
}

/** Atalhos de uma rankeada pronta, no estilo das abas do PropsBR (Melhor do dia,
 * 10 Melhores, Top Confiança, Top Vantagem, Top Score, Oportunidades, Múltiplas).
 * Cada um só ajusta sort/minConf/evOnly/limit — os filtros avançados continuam
 * disponíveis para afinar depois. */
const PRESETS = [
  { key: "melhor", label: "Melhor do dia", icon: Star, sort: "confidence" as SortKey, minConf: 0, evOnly: false },
  { key: "melhores", label: "10 Melhores", icon: Layers, sort: "confidence" as SortKey, minConf: 0, evOnly: false, limit: 10 },
  { key: "confianca", label: "Top Confiança", icon: ShieldCheck, sort: "confidence" as SortKey, minConf: 70, evOnly: false },
  { key: "vantagem", label: "Top Vantagem", icon: TrendingUp, sort: "ev" as SortKey, minConf: 0, evOnly: true, pro: true },
  { key: "score", label: "Top Score", icon: Rocket, sort: "score" as SortKey, minConf: 0, evOnly: false },
  { key: "quente", label: "Quente (L10)", icon: Flame, sort: "l10" as SortKey, minConf: 0, evOnly: false },
  { key: "oportunidades", label: "Oportunidades", icon: Sparkles, sort: "ev" as SortKey, minConf: 55, evOnly: false },
] as const;

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
  const [preset, setPreset] = useState<string>("melhor");
  const [limit, setLimit] = useState(PAGE);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [multiples, setMultiples] = useState<Map<string, PropRow>>(new Map());
  const [view, setView] = useState<"board" | "multiplas">("board");
  const [homeAway, setHomeAway] = useState<"all" | "home" | "away">("all");
  const [period, setPeriod] = useState<"all" | "today" | "tomorrow">("all");
  const [selectedGames, setSelectedGames] = useState<Set<number>>(new Set());
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

  /** Jogos do dia (estilo painel "JOGOS" do PropsBR) — um chip por partida,
   * derivado das próprias props (casa/fora a partir do ponto de vista de quem
   * é titular em cada linha), para filtrar o board por confronto específico. */
  const gamesList = useMemo(() => {
    const m = new Map<number, { id: number; home: string; away: string; start: string; live: boolean }>();
    for (const r of base) {
      if (sport !== "all" && r.sport_id !== sport) continue;
      if (m.has(r.game_id)) continue;
      const home = r.is_home ? r.team_abbr : r.opp_abbr;
      const away = r.is_home ? r.opp_abbr : r.team_abbr;
      m.set(r.game_id, {
        id: r.game_id,
        home: home ?? "?",
        away: away ?? "?",
        start: r.start_time,
        live: r.game_status === "live",
      });
    }
    return Array.from(m.values()).sort((a, b) => +new Date(a.start) - +new Date(b.start));
  }, [base, sport]);

  // Fuso fixo (America/Sao_Paulo) pra não divergir entre o render do servidor e do navegador.
  const today = brDateKey(new Date().toISOString());
  const tomorrow = brDateKey(new Date(Date.now() + 86400000).toISOString());

  const filtered = useMemo(() => {
    const out = base.filter(
      (r) =>
        (sport === "all" || r.sport_id === sport) &&
        (stat === "all" || r.stat_key === stat) &&
        r.confidence >= minConf &&
        (!evOnly || (r.ev ?? -1) >= 0.03) &&
        (homeAway === "all" || (homeAway === "home" ? r.is_home : !r.is_home)) &&
        (period === "all" || brDateKey(r.start_time) === (period === "today" ? today : tomorrow)) &&
        (selectedGames.size === 0 || selectedGames.has(r.game_id)) &&
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
      score: (a, b) => propScore(b) - propScore(a),
    };
    return out.sort(sorters[sort]);
  }, [base, sport, stat, minConf, evOnly, search, sort, homeAway, period, selectedGames, today, tomorrow]);

  /** Aba "Múltiplas": em vez de filtrar o board, mostra só as pernas já
   * selecionadas (igual ao painel "Multiple NBA" do PropsBR). */
  const multiplasRows = useMemo(() => Array.from(multiples.values()), [multiples]);
  const visibleRows = view === "multiplas" ? multiplasRows : filtered;

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

  const toggleMultiple = useCallback((row: PropRow) => {
    const key = `${row.market_id}:${row.side}`;
    setMultiples((m) => {
      const next = new Map(m);
      if (next.has(key)) next.delete(key);
      else next.set(key, row);
      return next;
    });
  }, []);

  const toggleGame = useCallback((id: number) => {
    setSelectedGames((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ---------------------------------------------------------------- render
  return (
    <div className={clsx("mx-auto max-w-[1400px] space-y-5 px-4 py-6", multiples.size > 0 && "pb-28")}>
      {/* Placar do dia */}
      <section className="grid grid-cols-2 divide-y divide-line rounded-xl border border-line bg-surface sm:grid-cols-4 sm:divide-y-0 sm:divide-x">
        <Kpi icon={<Target className="h-4 w-4" />} label="Props hoje" value={base.length.toLocaleString("pt-BR")} />
        <Kpi
          icon={<Flame className="h-4 w-4" />}
          label="Alertas EV+"
          value={isPremium ? String(evCount) : "Pro"}
          tone="text-brand-300"
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
        <p className="rounded-xl border border-brand-500/20 bg-brand-500/5 px-4 py-2.5 text-xs text-brand-200">
          <b>{modelCount}</b> props estão com <b>linha do modelo</b> (sem odd de casa no momento): a linha é a que o PropsEdge
          calcula como ~50/50 e a odd mostrada é a <b>odd justa</b>. Compare com a odd da sua casa antes de entrar.
        </p>
      )}

      {/* Rankeadas prontas */}
      <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" aria-label="Rankeadas">
        {PRESETS.map((p) => {
          const locked = "pro" in p && p.pro && !isPremium;
          const Icon = p.icon;
          return (
            <button
              key={p.key}
              disabled={locked}
              onClick={() => {
                setView("board");
                setPreset(p.key);
                setSort(p.sort);
                setMinConf(p.minConf);
                setEvOnly(p.evOnly);
                setLimit("limit" in p ? p.limit : PAGE);
              }}
              title={locked ? "Recurso Pro" : undefined}
              className={clsx(
                "flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition",
                locked
                  ? "cursor-not-allowed border-line text-slate-600"
                  : view === "board" && preset === p.key
                    ? "border-brand-400 bg-brand-500/15 text-brand-200"
                    : "border-line text-slate-300 hover:border-slate-500",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {p.label}
            </button>
          );
        })}
        <button
          onClick={() => setView("multiplas")}
          className={clsx(
            "flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition",
            view === "multiplas"
              ? "border-violet-400 bg-violet-500/15 text-violet-200"
              : "border-line text-slate-300 hover:border-slate-500",
          )}
        >
          <Layers className="h-3.5 w-3.5" />
          Múltiplas{multiples.size > 0 ? ` (${multiples.size})` : ""}
        </button>
      </nav>

      {/* Esportes */}
      <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" aria-label="Esportes">
        <SportChip active={sport === "all"} onClick={() => { setSport("all"); setStat("all"); setSelectedGames(new Set()); }} label="Todos" count={base.length} />
        {SPORTS.map((s) => (
          <SportChip
            key={s.id}
            active={sport === s.id}
            onClick={() => { setSport(s.id); setStat("all"); setLimit(PAGE); setSelectedGames(new Set()); }}
            label={`${s.emoji} ${s.label}`}
            count={sportCounts[s.id] ?? 0}
          />
        ))}
      </nav>

      {/* Layout 3 colunas: Jogos | Board | Filtros (igual ao PropsBR) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)_260px]">
        <GamesSidebar
          games={gamesList}
          selected={selectedGames}
          onToggle={toggleGame}
          onClear={() => setSelectedGames(new Set())}
        />

        <div className="min-w-0 space-y-4">
          {/* Mercados — botões horizontais (igual à linha de mercados do PropsBR) */}
          <nav className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="Mercados">
            <button
              onClick={() => setStat("all")}
              className={clsx(
                "shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition",
                stat === "all" ? "border-brand-400 bg-brand-500/15 text-brand-200" : "border-line text-slate-300 hover:border-slate-500",
              )}
            >
              Todos os mercados
            </button>
            {statOptions.map(([k, label]) => (
              <button
                key={k}
                onClick={() => setStat(k)}
                className={clsx(
                  "shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition",
                  stat === k ? "border-brand-400 bg-brand-500/15 text-brand-200" : "border-line text-slate-300 hover:border-slate-500",
                )}
              >
                {label}
              </button>
            ))}
          </nav>

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
              <span />
            </div>

            {error && <p className="p-6 text-sm text-rose-300">Erro ao carregar: {error}</p>}
            {loading && !rows.length && <SkeletonRows />}
            {!loading && !visibleRows.length && (
              <p className="p-10 text-center text-sm text-slate-400">
                {view === "multiplas"
                  ? "Nenhuma prop na múltipla ainda — clique no ícone roxo de uma prop para adicionar."
                  : rows.length
                    ? "Nenhuma prop com esses filtros."
                    : "Nenhuma prop para as próximas 36h ainda — as props são geradas a cada 15 min conforme a agenda."}
              </p>
            )}

            <ul>
              {visibleRows.slice(0, view === "multiplas" ? undefined : limit).map((r) => {
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
                    inMultiple={multiples.has(key)}
                    onToggleMultiple={() => toggleMultiple(r)}
                  />
                );
              })}
            </ul>

            {view === "board" && filtered.length > limit && (
              <button
                onClick={() => setLimit((l) => l + PAGE)}
                className="w-full border-t border-line py-3 text-sm text-brand-300 hover:bg-white/[0.03]"
              >
                Carregar mais ({filtered.length - limit} restantes)
              </button>
            )}
          </section>
        </div>

        <FiltersSidebar
          query={query}
          onQuery={setQuery}
          minConf={minConf}
          onMinConf={setMinConf}
          evOnly={evOnly}
          onEvOnly={setEvOnly}
          evLocked={!isPremium}
          bothSides={bothSides}
          onBothSides={setBothSides}
          homeAway={homeAway}
          onHomeAway={setHomeAway}
          period={period}
          onPeriod={setPeriod}
          sort={sort}
          onSort={setSort}
          loading={loading}
          updatedAt={updatedAt}
          onReload={reload}
        />
      </div>

      <MultiplesBar
        legs={Array.from(multiples.values())}
        onRemove={(key) => setMultiples((m) => { const next = new Map(m); next.delete(key); return next; })}
        onClear={() => setMultiples(new Map())}
      />
    </div>
  );
}

// ------------------------------------------------------------------ UI local
function Kpi({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone?: string }) {
  return (
    <div className="p-4">
      <p className="flex items-center gap-1.5 text-xs text-slate-500">{icon}{label}</p>
      <p className={clsx("mt-1 font-display text-2xl font-bold tabular-nums", tone ?? "text-slate-100")}>{value}</p>
    </div>
  );
}

function SportChip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition",
        active ? "border-brand-400 bg-brand-500/15 text-brand-200" : "border-line text-slate-300 hover:border-slate-500",
      )}
    >
      {label}
      <span className={clsx("rounded-full px-1.5 text-[11px] tabular-nums", active ? "bg-brand-400/20" : "bg-white/5 text-slate-500")}>
        {count}
      </span>
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
