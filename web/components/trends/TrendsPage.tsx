"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { ArrowDownWideNarrow, BarChart3, HeartPulse, ListOrdered, Search, Swords, Users } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { kickoff } from "@/lib/format";
import { leagueName } from "@/lib/leagues";
import { SPORTS } from "@/lib/constants";
import type { GamePrediction, InjuryRow, LeagueTrend, StandingRow, TeamTrend } from "@/lib/types";
import { TeamLogo } from "@/components/teams/Widgets";

type Tab = "jogos" | "ligas" | "times" | "tabela" | "desfalques";

const TABS: { id: Tab; label: string; icon: typeof BarChart3 }[] = [
  { id: "jogos", label: "Jogos de hoje", icon: Swords },
  { id: "ligas", label: "Ligas", icon: BarChart3 },
  { id: "times", label: "Times", icon: Users },
  { id: "tabela", label: "Classificação", icon: ListOrdered },
  { id: "desfalques", label: "Desfalques", icon: HeartPulse },
];

/** Tendências (estilo PackBall): % de over, ambas marcam, escanteios e cartões por liga e por time,
 *  probabilidades 1X2 dos jogos, classificação e desfalques. Tudo calculado com os jogos já no banco. */
export function TrendsPage() {
  const [tab, setTab] = useState<Tab>("jogos");
  return (
    <div className="mx-auto max-w-[1200px] space-y-5 px-4 py-6">
      <header className="flex flex-wrap items-center gap-2">
        <BarChart3 className="h-5 w-5 text-emerald-300" />
        <h1 className="text-lg font-bold text-white">Tendências</h1>
        <span className="text-sm text-slate-500">· over, ambas marcam, escanteios, cartões, 1X2 e tabela</span>
      </header>
      <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={clsx("flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm",
              tab === id ? "border-emerald-400 bg-emerald-500/15 text-emerald-200" : "border-line text-slate-300 hover:border-slate-500")}>
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </nav>
      {tab === "jogos" && <GamesTab />}
      {tab === "ligas" && <LeaguesTab />}
      {tab === "times" && <TeamsTab />}
      {tab === "tabela" && <StandingsTab />}
      {tab === "desfalques" && <InjuriesTab />}
      <p className="text-center text-xs text-slate-500">
        Percentuais calculados com os jogos já registrados no PropsEdge. +18 · Aposta não é investimento.
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ helpers
function useView<T>(view: string, order: { col: string; asc?: boolean }) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getSupabase().from(view).select("*").order(order.col, { ascending: order.asc ?? true }).limit(3000)
      .then(({ data, error }) => {
      if (error) setError(error.message);
      setRows((data ?? []) as T[]);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  return { rows, loading, error };
}

const n = (v: unknown) => (v == null ? null : Number(v));

function Pct({ v, strong = 0.7, good = 0.55 }: { v: number | string | null; strong?: number; good?: number }) {
  const x = n(v);
  if (x == null) return <span className="text-slate-600">—</span>;
  return (
    <span className={clsx("tabular-nums font-semibold",
      x >= strong ? "text-emerald-300" : x >= good ? "text-green-400" : x >= 0.45 ? "text-amber-300" : "text-slate-400")}>
      {Math.round(x * 100)}%
    </span>
  );
}

const fair = (p: number | null) => (p && p > 0 ? (1 / p).toFixed(2) : "—");

function Status({ loading, error, empty, text }: { loading: boolean; error: string | null; empty: boolean; text: string }) {
  if (error) return <p className="text-sm text-rose-300">Erro: {error}</p>;
  if (loading) return <p className="text-sm text-slate-400">Carregando…</p>;
  if (empty) return <p className="rounded-xl border border-line bg-surface p-10 text-center text-sm text-slate-400">{text}</p>;
  return null;
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-emerald-400">
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

function Form({ form }: { form: string | null }) {
  if (!form) return <span className="text-slate-600">—</span>;
  return (
    <span className="inline-flex gap-0.5">
      {form.split("").map((c, i) => (
        <span key={i} className={clsx("flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold",
          c === "V" ? "bg-emerald-500/20 text-emerald-300" : c === "E" ? "bg-slate-500/20 text-slate-300" : "bg-rose-500/20 text-rose-300")}>{c}</span>
      ))}
    </span>
  );
}

// ------------------------------------------------------------------ Jogos de hoje (1X2 / over / ambas)
function GamesTab() {
  const { rows, loading, error } = useView<GamePrediction>("v_game_predictions", { col: "start_time" });
  const [league, setLeague] = useState("all");
  const leagues = useMemo(() => Array.from(new Set(rows.map((r) => r.league_slug ?? ""))).filter(Boolean), [rows]);
  const list = rows.filter((r) => league === "all" || r.league_slug === league);
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={league} onChange={setLeague} options={[["all", "Todas as ligas"], ...leagues.map((l) => [l, leagueName(l)] as [string, string])]} />
        <span className="text-xs text-slate-500">Probabilidades pelos gols esperados de cada time (Poisson) · odd justa = 1 ÷ probabilidade</span>
      </div>
      <Status loading={loading} error={error} empty={!list.length} text="Nenhum jogo de futebol nas próximas 72h com histórico suficiente." />
      <ul className="grid gap-3 md:grid-cols-2">
        {list.map((g) => {
          const ph = n(g.p_home) ?? 0, pd = n(g.p_draw) ?? 0, pa = n(g.p_away) ?? 0;
          return (
            <li key={g.game_id} className="rounded-2xl border border-line bg-surface p-4">
              <p className="text-xs text-slate-400">{kickoff(g.start_time)} · {leagueName(g.league_slug)}</p>
              <div className="mt-2 flex items-center gap-2">
                <TeamLogo src={g.home_logo} alt={g.home_name} size={30} />
                <p className="min-w-0 flex-1 truncate font-semibold text-slate-100">
                  {g.home_name}{g.home_rank ? <span className="text-xs font-normal text-slate-500"> ({g.home_rank}º)</span> : null}
                  <span className="text-slate-500"> x </span>
                  {g.away_name}{g.away_rank ? <span className="text-xs font-normal text-slate-500"> ({g.away_rank}º)</span> : null}
                </p>
                <TeamLogo src={g.away_logo} alt={g.away_name} size={30} />
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Gols esperados: <b className="text-slate-300">{n(g.lambda_home)?.toFixed(2)}</b> x <b className="text-slate-300">{n(g.lambda_away)?.toFixed(2)}</b>
              </p>
              <div className="mt-3 flex h-7 overflow-hidden rounded-lg text-[11px] font-bold">
                <span className="flex items-center justify-center bg-emerald-500/30 text-emerald-100" style={{ width: `${ph * 100}%` }}>1 · {Math.round(ph * 100)}%</span>
                <span className="flex items-center justify-center bg-slate-500/30 text-slate-100" style={{ width: `${pd * 100}%` }}>X · {Math.round(pd * 100)}%</span>
                <span className="flex items-center justify-center bg-sky-500/30 text-sky-100" style={{ width: `${pa * 100}%` }}>2 · {Math.round(pa * 100)}%</span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                {([["Over 1.5", g.p_over15], ["Over 2.5", g.p_over25], ["Ambas marcam", g.p_btts]] as [string, number][]).map(([l, p]) => (
                  <div key={l} className="rounded-lg bg-bg/60 py-2">
                    <p className="text-slate-500">{l}</p>
                    <p className="text-base"><Pct v={p} /></p>
                    <p className="text-[11px] text-slate-500">odd justa {fair(n(p))}</p>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                Odd justa 1X2: {fair(ph)} · {fair(pd)} · {fair(pa)}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------ Ligas
const LEAGUE_COLS: { key: keyof LeagueTrend; label: string; pct?: boolean }[] = [
  { key: "games", label: "Jogos" }, { key: "goals_avg", label: "Gols/j" },
  { key: "over15", label: "+1.5", pct: true }, { key: "over25", label: "+2.5", pct: true }, { key: "over35", label: "+3.5", pct: true },
  { key: "btts", label: "Ambas", pct: true }, { key: "ht_over05", label: "Gol 1T", pct: true },
  { key: "home_win", label: "Casa", pct: true }, { key: "draw", label: "Empate", pct: true }, { key: "away_win", label: "Fora", pct: true },
  { key: "corners_avg", label: "Esc/j" }, { key: "corners_o95", label: "Esc +9.5", pct: true }, { key: "corners_o105", label: "Esc +10.5", pct: true },
  { key: "cards_avg", label: "Cart/j" }, { key: "cards_o35", label: "Cart +3.5", pct: true }, { key: "cards_o45", label: "Cart +4.5", pct: true },
];

function LeaguesTab() {
  const { rows, loading, error } = useView<LeagueTrend>("v_league_trends", { col: "games", asc: false });
  const [sort, setSort] = useState<keyof LeagueTrend>("over25");
  const list = useMemo(() => [...rows].sort((a, b) => (n(b[sort]) ?? -1) - (n(a[sort]) ?? -1)), [rows, sort]);
  return (
    <section className="space-y-3">
      <p className="flex items-center gap-1 text-xs text-slate-500"><ArrowDownWideNarrow className="h-3.5 w-3.5" /> Clique no título da coluna para ordenar · últimos 150 dias</p>
      <Status loading={loading} error={error} empty={!list.length} text="Sem jogos encerrados suficientes ainda." />
      {!!list.length && (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-slate-500">
              <tr className="border-b border-line">
                <th className="sticky left-0 bg-surface px-3 py-2 text-left">Liga</th>
                {LEAGUE_COLS.map((c) => (
                  <th key={c.key} onClick={() => setSort(c.key)}
                    className={clsx("cursor-pointer px-2 py-2 text-center hover:text-slate-200", sort === c.key && "text-emerald-300")}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.league} className="border-b border-line/60 last:border-0">
                  <td className="sticky left-0 whitespace-nowrap bg-surface px-3 py-2 font-semibold text-slate-100">{leagueName(r.league)}</td>
                  {LEAGUE_COLS.map((c) => (
                    <td key={c.key} className="px-2 py-2 text-center tabular-nums text-slate-300">
                      {c.pct ? <Pct v={r[c.key] as number} /> : r[c.key] == null ? "—" : String(r[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ Times
const TEAM_COLS: { key: keyof TeamTrend; label: string; pct?: boolean; title?: string }[] = [
  { key: "gf_avg", label: "Marca" }, { key: "ga_avg", label: "Sofre" },
  { key: "over15", label: "+1.5", pct: true }, { key: "over25", label: "+2.5", pct: true },
  { key: "over25_home", label: "+2.5 casa", pct: true }, { key: "over25_away", label: "+2.5 fora", pct: true },
  { key: "btts", label: "Ambas", pct: true }, { key: "btts_home", label: "Ambas casa", pct: true }, { key: "btts_away", label: "Ambas fora", pct: true },
  { key: "clean_sheet", label: "Sem sofrer", pct: true }, { key: "failed_to_score", label: "Não marca", pct: true },
  { key: "corners_avg", label: "Esc/j" }, { key: "corners_o95", label: "Esc +9.5", pct: true }, { key: "cards_avg", label: "Cart/j" },
];

function TeamsTab() {
  const { rows, loading, error } = useView<TeamTrend>("v_team_trends", { col: "team_name" });
  const [league, setLeague] = useState("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<keyof TeamTrend>("over25");
  const leagues = useMemo(() => Array.from(new Set(rows.map((r) => r.league ?? ""))).filter(Boolean).sort(), [rows]);
  const list = useMemo(() => rows
    .filter((r) => r.games >= 5 && (league === "all" || r.league === league) && (!q || r.team_name.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (n(b[sort]) ?? -1) - (n(a[sort]) ?? -1)), [rows, league, q, sort]);
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar time…"
            className="w-full rounded-lg border border-line bg-bg py-2 pl-9 pr-3 text-sm outline-none focus:border-emerald-400" />
        </div>
        <Select value={league} onChange={setLeague} options={[["all", "Todas as ligas"], ...leagues.map((l) => [l, leagueName(l)] as [string, string])]} />
      </div>
      <p className="text-xs text-slate-500">Últimos 10 jogos (casa/fora: últimos 20) · mínimo de 5 jogos · clique na coluna para ordenar</p>
      <Status loading={loading} error={error} empty={!list.length} text="Nenhum time com 5+ jogos registrados nesse filtro." />
      {!!list.length && (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[1080px] text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-slate-500">
              <tr className="border-b border-line">
                <th className="sticky left-0 bg-surface px-3 py-2 text-left">Time</th>
                <th className="px-2 py-2 text-center">Forma</th>
                {TEAM_COLS.map((c) => (
                  <th key={c.key} onClick={() => setSort(c.key)}
                    className={clsx("cursor-pointer px-2 py-2 text-center hover:text-slate-200", sort === c.key && "text-emerald-300")}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.slice(0, 200).map((r) => (
                <tr key={r.team_id} className="border-b border-line/60 last:border-0">
                  <td className="sticky left-0 bg-surface px-3 py-2">
                    <span className="flex items-center gap-2 whitespace-nowrap font-semibold text-slate-100">
                      <TeamLogo src={r.team_logo} alt={r.team_name} size={22} />{r.team_name}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-center"><Form form={r.form} /></td>
                  {TEAM_COLS.map((c) => (
                    <td key={c.key} className="px-2 py-2 text-center tabular-nums text-slate-300">
                      {c.pct ? <Pct v={r[c.key] as number} /> : r[c.key] == null ? "—" : String(r[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ Classificação
function StandingsTab() {
  const { rows, loading, error } = useView<StandingRow>("v_standings", { col: "rank" });
  const leagues = useMemo(() => Array.from(new Set(rows.map((r) => r.league))).sort(), [rows]);
  const [league, setLeague] = useState("");
  const cur = league || leagues.find((l) => l === "soccer/bra.1") || leagues[0] || "";
  const groups = useMemo(() => {
    const m = new Map<string, StandingRow[]>();
    rows.filter((r) => r.league === cur).forEach((r) => {
      const k = r.group_name ?? "";
      m.set(k, [...(m.get(k) ?? []), r]);
    });
    return Array.from(m.entries());
  }, [rows, cur]);
  const isSoccer = cur.startsWith("soccer/");
  return (
    <section className="space-y-3">
      <Select value={cur} onChange={setLeague} options={leagues.map((l) => [l, leagueName(l)] as [string, string])} />
      <Status loading={loading} error={error} empty={!groups.length} text="A classificação é atualizada junto com a agenda (a cada 3h)." />
      {groups.map(([g, list]) => (
        <div key={g} className="overflow-x-auto rounded-xl border border-line bg-surface">
          {g && <p className="border-b border-line px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{g}</p>}
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-[11px] uppercase text-slate-500">
              <tr className="border-b border-line">
                <th className="w-10 px-3 py-2 text-left">#</th><th className="px-2 py-2 text-left">Time</th>
                <th className="px-2 py-2 text-center">J</th><th className="px-2 py-2 text-center">V</th>
                {isSoccer && <th className="px-2 py-2 text-center">E</th>}
                <th className="px-2 py-2 text-center">D</th>
                <th className="px-2 py-2 text-center">{isSoccer ? "GP" : "PF"}</th><th className="px-2 py-2 text-center">{isSoccer ? "GC" : "PA"}</th>
                <th className="px-2 py-2 text-center">Saldo</th><th className="px-2 py-2 text-center">{isSoccer ? "Pts" : "V"}</th>
              </tr>
            </thead>
            <tbody>
              {[...list].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).map((r) => (
                <tr key={r.team_id} className="border-b border-line/60 last:border-0">
                  <td className="px-3 py-2 font-bold tabular-nums text-slate-400">{r.rank ?? "—"}</td>
                  <td className="px-2 py-2">
                    <span className="flex items-center gap-2 whitespace-nowrap font-semibold text-slate-100">
                      <TeamLogo src={r.team_logo} alt={r.team_name} size={20} />{r.team_name}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-center tabular-nums">{r.played ?? "—"}</td>
                  <td className="px-2 py-2 text-center tabular-nums">{r.wins ?? "—"}</td>
                  {isSoccer && <td className="px-2 py-2 text-center tabular-nums">{r.draws ?? "—"}</td>}
                  <td className="px-2 py-2 text-center tabular-nums">{r.losses ?? "—"}</td>
                  <td className="px-2 py-2 text-center tabular-nums">{n(r.goals_for) ?? "—"}</td>
                  <td className="px-2 py-2 text-center tabular-nums">{n(r.goals_against) ?? "—"}</td>
                  <td className="px-2 py-2 text-center tabular-nums">{n(r.goal_diff) ?? "—"}</td>
                  <td className="px-2 py-2 text-center font-bold tabular-nums text-white">{n(r.points) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}

// ------------------------------------------------------------------ Desfalques
function InjuriesTab() {
  const { rows, loading, error } = useView<InjuryRow>("v_injuries", { col: "team_name" });
  const sports = useMemo(() => Array.from(new Set(rows.map((r) => r.sport_id))), [rows]);
  const [sport, setSport] = useState("");
  const [q, setQ] = useState("");
  const cur = sport || sports[0] || "";
  const byTeam = useMemo(() => {
    const m = new Map<string, InjuryRow[]>();
    rows.filter((r) => r.sport_id === cur && (!q || `${r.team_name} ${r.name}`.toLowerCase().includes(q.toLowerCase())))
      .forEach((r) => { const k = r.team_name ?? "—"; m.set(k, [...(m.get(k) ?? []), r]); });
    return Array.from(m.entries());
  }, [rows, cur, q]);
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={cur} onChange={setSport} options={sports.map((s) => [s, SPORTS.find((x) => x.id === s)?.label ?? s] as [string, string])} />
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar time ou jogador…"
            className="w-full rounded-lg border border-line bg-bg py-2 pl-9 pr-3 text-sm outline-none focus:border-emerald-400" />
        </div>
      </div>
      <p className="text-xs text-slate-500">Times com jogo nas próximas 36h · fonte ESPN (NBA, NFL, MLB, NHL, WNBA). Futebol: o ESPN só publica a escalação ~1h antes.</p>
      <Status loading={loading} error={error} empty={!byTeam.length} text="Nenhum desfalque informado para os próximos jogos." />
      <div className="grid gap-3 md:grid-cols-2">
        {byTeam.map(([team, list]) => (
          <div key={team} className="rounded-xl border border-line bg-surface">
            <p className="border-b border-line px-3 py-2 font-semibold text-slate-100">{team}</p>
            <ul className="divide-y divide-line/60 text-sm">
              {list.map((r) => (
                <li key={`${r.name}-${r.status}`} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-0 truncate text-slate-200">{r.name} <span className="text-xs text-slate-500">{r.position ?? ""}</span></span>
                  <span className="shrink-0 text-right text-xs">
                    <b className={clsx(/out|il|reserve|susp/i.test(r.status) ? "text-rose-300" : "text-amber-300")}>{r.status}</b>
                    {r.detail && <span className="block text-slate-500">{r.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
