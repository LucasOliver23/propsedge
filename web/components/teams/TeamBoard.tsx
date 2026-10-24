"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { ChevronDown, Search, Shield } from "lucide-react";
import { useTeamBoard } from "@/hooks/useTeamBoard";
import { useTrackedBets } from "@/hooks/useTrackedBets";
import { SPORTS } from "@/lib/constants";
import { brDateKey, kickoff } from "@/lib/format";
import { leagueName } from "@/lib/leagues";
import type { SportId, Subject, TeamMarketRow } from "@/lib/types";
import { TeamMarketCard } from "./TeamMarketCard";
import { ScoreRing, TeamLogo } from "./Widgets";

const PAGE = 50;
const key = (r: TeamMarketRow) => `${r.game_id}:${r.subject}:${r.stat_key}`;

type Period = "all" | "today" | "tomorrow";

/** Mercados de TIME e de JOGO: escanteios, gols, 1º tempo, faltas, chutes, cartões, pontos por quarto… */
export function TeamBoard() {
  const router = useRouter();
  const { rows, loading, error } = useTeamBoard();
  const { user, profile, trackTeam } = useTrackedBets();

  const [sport, setSport] = useState<SportId | "all">("all");
  const [league, setLeague] = useState("all");
  const [market, setMarket] = useState("all");
  const [subject, setSubject] = useState<"all" | "team" | "match">("all");
  const [period, setPeriod] = useState<Period>("all");
  const [minScore, setMinScore] = useState(60);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);
  const q = useDeferredValue(query.trim().toLowerCase());

  const sportCounts = useMemo(() => {
    const c: Record<string, number> = {};
    rows.forEach((r) => (c[r.sport_id] = (c[r.sport_id] ?? 0) + 1));
    return c;
  }, [rows]);

  const leagues = useMemo(
    () => Array.from(new Set(rows.filter((r) => sport === "all" || r.sport_id === sport).map((r) => r.league_slug ?? ""))).filter(Boolean),
    [rows, sport],
  );
  const markets = useMemo(() => {
    const m = new Map<string, string>();
    rows.filter((r) => sport === "all" || r.sport_id === sport).forEach((r) => m.set(r.stat_key, r.stat_label ?? r.stat_key));
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows, sport]);

  // Mesma lógica de "Hoje"/"Amanhã" usada no filtro de período dos Props (FiltersSidebar),
  // pra não ficar com o quadro vazio quando não há jogo hoje e não existir onde filtrar.
  const todayKey = brDateKey(new Date().toISOString());
  const tomorrowKey = brDateKey(new Date(Date.now() + 86400000).toISOString());

  const filtered = useMemo(() => rows.filter((r) =>
    (sport === "all" || r.sport_id === sport) &&
    (league === "all" || r.league_slug === league) &&
    (market === "all" || r.stat_key === market) &&
    (subject === "all" || (subject === "match" ? r.subject === "match" : r.subject !== "match")) &&
    (period === "all" || brDateKey(r.start_time) === (period === "today" ? todayKey : tomorrowKey)) &&
    r.score >= minScore &&
    (!q || `${r.home_name} ${r.away_name} ${r.team_name ?? ""}`.toLowerCase().includes(q)),
  ), [rows, sport, league, market, subject, period, todayKey, tomorrowKey, minScore, q]);

  const periodCounts = useMemo(() => {
    const base = rows.filter((r) =>
      (sport === "all" || r.sport_id === sport) &&
      (league === "all" || r.league_slug === league) &&
      (market === "all" || r.stat_key === market) &&
      (subject === "all" || (subject === "match" ? r.subject === "match" : r.subject !== "match")),
    );
    return {
      all: base.length,
      today: base.filter((r) => brDateKey(r.start_time) === todayKey).length,
      tomorrow: base.filter((r) => brDateKey(r.start_time) === tomorrowKey).length,
    };
  }, [rows, sport, league, market, subject, todayKey, tomorrowKey]);

  async function pin(r: TeamMarketRow, a: { side: "over" | "under"; line: number; odds: number; stake: number }) {
    if (!user) { router.push("/login?next=/times"); throw new Error("Entre na sua conta para fixar."); }
    await trackTeam({
      gameId: r.game_id, kind: r.subject === "match" ? "match" : "team", teamId: r.subject === "match" ? null : r.team_id,
      statKey: r.stat_key, side: a.side, line: a.line, odds: a.odds, stake: a.stake,
    });
  }

  return (
    <div className="mx-auto max-w-[1360px] space-y-5 px-4 py-6">
      <header className="flex items-center gap-2">
        <Shield className="h-5 w-5 text-brand-300" />
        <h1 className="font-display text-lg font-bold italic text-white">Mercados de times e jogos</h1>
        <span className="text-sm text-slate-500">· escanteios, gols, 1º tempo, faltas, chutes, cartões…</span>
      </header>

      <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <Chip active={sport === "all"} onClick={() => { setSport("all"); setLeague("all"); setMarket("all"); }} label="Todos" count={rows.length} />
        {SPORTS.filter((s) => sportCounts[s.id]).map((s) => (
          <Chip key={s.id} active={sport === s.id} onClick={() => { setSport(s.id); setLeague("all"); setMarket("all"); }}
            label={`${s.emoji} ${s.label}`} count={sportCounts[s.id]} />
        ))}
      </nav>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0 space-y-3">
          {error && <p className="text-sm text-rose-300">Erro: {error}</p>}
          {loading && <p className="text-sm text-slate-400">Carregando…</p>}
          {!loading && !filtered.length && (
            <p className="rounded-xl border border-line bg-surface p-10 text-center text-sm text-slate-400">
              Nenhum mercado com esses filtros.{" "}
              {period !== "all"
                ? "Tente \"Qualquer dia\" — pode não ter jogo nesse dia pra esse esporte/liga."
                : "Tente baixar o score mínimo."}
            </p>
          )}

          <ul className="space-y-2">
            {filtered.slice(0, limit).map((r) => {
              const k = key(r);
              const isMatch = r.subject === "match";
              const yesNo = r.stat_key === "btts";
              const isHandicap = r.stat_key === "handicap";
              const hcFavored = Number(r.default_line) > 0 ? r.home_abbr : r.away_abbr;
              return (
                <li key={k} className="rounded-xl border border-line bg-surface">
                  <button onClick={() => setOpen((o) => (o === k ? null : k))} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02]">
                    <TeamLogo src={isMatch ? r.home_logo : r.team_logo} alt={isMatch ? r.home_name : r.team_name ?? ""} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-slate-100">
                        {isMatch ? `${r.home_name} x ${r.away_name}` : r.team_name}
                        {!isMatch && <span className="ml-1 text-xs font-normal text-slate-500">{r.subject === "home" ? "🏠 vs" : "✈️ @"} {r.subject === "home" ? r.away_abbr : r.home_abbr}</span>}
                      </p>
                      <p className="truncate text-xs text-slate-400">
                        {kickoff(r.start_time)} · {leagueName(r.league_slug)}
                        {(r.home_rank || r.away_rank) ? ` · ${r.home_rank ?? "—"}º x ${r.away_rank ?? "—"}º` : ""}
                      </p>
                    </div>
                    <div className="hidden text-right sm:block">
                      <p className="text-sm">
                        {isHandicap ? (
                          <span className="mr-1 rounded bg-brand-500/15 px-1.5 py-0.5 text-[11px] font-bold uppercase text-brand-300">
                            {hcFavored} -{Math.abs(Number(r.default_line))}
                          </span>
                        ) : (
                          <span className={clsx("mr-1 rounded px-1.5 py-0.5 text-[11px] font-bold uppercase", r.default_side === "over" ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300")}>
                            {yesNo ? (r.default_side === "over" ? "Sim" : "Não") : r.default_side === "over" ? "Mais" : "Menos"}
                          </span>
                        )}
                        {!yesNo && !isHandicap && <><b className="tabular-nums text-white">{Number(r.default_line)}</b>{" "}</>}
                        <span className="text-slate-300">{isHandicap ? "Handicap asiático" : r.stat_label}{isMatch && !yesNo && !isHandicap ? " (jogo)" : ""}</span>
                      </p>
                      <p className="text-xs text-slate-500">
                        {isHandicap ? (
                          <>gols esp. {r.data?.home_avg?.toFixed(1) ?? "—"} x {r.data?.away_avg?.toFixed(1) ?? "—"}</>
                        ) : (
                          <>
                            L10 {r.hit_l10 != null ? `${Math.round(Number(r.hit_l10) * 100)}%` : "—"} ·{" "}
                            {yesNo ? <>chance {r.data?.p_btts != null ? `${Math.round(Number(r.data.p_btts) * 100)}%` : "—"}</>
                              : <>proj. {r.projection != null ? Number(r.projection).toFixed(1) : "—"}</>}
                          </>
                        )}
                        {r.model_prob ? <> · odd justa <b className="text-slate-300">{(1 / Number(r.model_prob)).toFixed(2)}</b></> : null}
                        {r.matchup_grade && <> · matchup <b className="text-slate-300">{r.matchup_grade}</b></>}
                      </p>
                    </div>
                    <ScoreRing value={r.score} size={44} />
                    <ChevronDown className={clsx("h-4 w-4 text-slate-500 transition", open === k && "rotate-180")} />
                  </button>
                  {open === k && (
                    <div className="border-t border-line p-3">
                      <TeamMarketCard row={r} defaultStake={Number(profile?.unit_size ?? 10)} onPin={(a) => pin(r, a)} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {filtered.length > limit && (
            <button onClick={() => setLimit((l) => l + PAGE)} className="w-full rounded-xl border border-line py-3 text-sm text-brand-300 hover:bg-white/[0.03]">
              Carregar mais ({filtered.length - limit})
            </button>
          )}
        </div>

        <TeamFiltersSidebar
          query={query} onQuery={setQuery}
          league={league} onLeague={setLeague} leagues={leagues}
          market={market} onMarket={setMarket} markets={markets}
          subject={subject} onSubject={setSubject}
          period={period} onPeriod={setPeriod} periodCounts={periodCounts}
          minScore={minScore} onMinScore={setMinScore}
        />
      </div>
    </div>
  );
}

function Chip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button onClick={onClick} className={clsx("flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm",
      active ? "border-brand-400 bg-brand-500/15 text-brand-200" : "border-line text-slate-300 hover:border-slate-500")}>
      {label}<span className="rounded-full bg-white/5 px-1.5 text-[11px] tabular-nums">{count}</span>
    </button>
  );
}

/** Painel "Filtros" à direita (mesmo padrão da FiltersSidebar de Props): busca, liga,
 * mercado, time/jogo, período (com contador) e score mínimo, tudo num só lugar fixo. */
function TeamFiltersSidebar(props: {
  query: string; onQuery: (v: string) => void;
  league: string; onLeague: (v: string) => void; leagues: string[];
  market: string; onMarket: (v: string) => void; markets: [string, string][];
  subject: "all" | "team" | "match"; onSubject: (v: "all" | "team" | "match") => void;
  period: Period; onPeriod: (v: Period) => void; periodCounts: Record<Period, number>;
  minScore: number; onMinScore: (v: number) => void;
}) {
  return (
    <aside className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3.5 lg:sticky lg:top-4 lg:self-start">
      <h2 className="text-xs font-bold font-display uppercase tracking-wide text-slate-300">Filtros</h2>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input
          value={props.query} onChange={(e) => props.onQuery(e.target.value)} placeholder="Buscar time…"
          className="w-full rounded-lg border border-line bg-bg py-2 pl-9 pr-3 text-sm outline-none focus:border-brand-400"
        />
      </div>

      <Section title="Liga" defaultOpen>
        <Select value={props.league} onChange={props.onLeague}
          options={[["all", "Todas as ligas"], ...props.leagues.map((l) => [l, leagueName(l)] as [string, string])]} />
      </Section>

      <Section title="Mercado" defaultOpen>
        <Select value={props.market} onChange={props.onMarket} options={[["all", "Todos os mercados"], ...props.markets]} />
      </Section>

      <Section title="Time ou jogo" defaultOpen>
        <div className="flex overflow-hidden rounded-lg border border-line text-xs">
          {([["all", "Time + Jogo"], ["team", "Só time"], ["match", "Só jogo"]] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => props.onSubject(v)}
              className={clsx(
                "flex-1 px-2.5 py-2 font-medium transition",
                props.subject === v ? "bg-brand-500/15 text-brand-200" : "text-slate-400 hover:bg-white/5",
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
                "flex flex-col items-center gap-0.5 rounded-lg border px-2 py-2 text-[11px] font-semibold transition",
                props.period === v ? "border-brand-400 bg-brand-500/15 text-brand-200" : "border-line text-slate-300 hover:border-slate-500",
              )}
            >
              {label}
              <span className="text-[10px] font-normal tabular-nums text-slate-500">{props.periodCounts[v]}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Score mínimo" defaultOpen>
        <label className="flex items-center justify-between gap-2 text-sm text-slate-300">
          <span>Score ≥ <b className="tabular-nums">{props.minScore}</b></span>
          <input
            type="range" min={0} max={90} step={5} value={props.minScore}
            onChange={(e) => props.onMinScore(Number(e.target.value))}
            className="accent-brand-400"
          />
        </label>
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
        className="flex w-full items-center justify-between text-xs font-bold font-display uppercase tracking-wide text-slate-300"
      >
        {title}
        <ChevronDown className={clsx("h-3.5 w-3.5 text-slate-500 transition", open && "rotate-180")} />
      </button>
      {open && <div className="mt-2.5">{children}</div>}
    </div>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-brand-400">
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}
