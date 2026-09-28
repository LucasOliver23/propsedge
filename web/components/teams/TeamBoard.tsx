"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { ChevronDown, Search, Shield } from "lucide-react";
import { useTeamBoard } from "@/hooks/useTeamBoard";
import { useTrackedBets } from "@/hooks/useTrackedBets";
import { SPORTS } from "@/lib/constants";
import { kickoff } from "@/lib/format";
import { leagueName } from "@/lib/leagues";
import type { SportId, Subject, TeamMarketRow } from "@/lib/types";
import { TeamMarketCard } from "./TeamMarketCard";
import { ScoreRing, TeamLogo } from "./Widgets";

const PAGE = 50;
const key = (r: TeamMarketRow) => `${r.game_id}:${r.subject}:${r.stat_key}`;

/** Mercados de TIME e de JOGO: escanteios, gols, 1º tempo, faltas, chutes, cartões, pontos por quarto… */
export function TeamBoard() {
  const router = useRouter();
  const { rows, loading, error } = useTeamBoard();
  const { user, profile, trackTeam } = useTrackedBets();

  const [sport, setSport] = useState<SportId | "all">("all");
  const [league, setLeague] = useState("all");
  const [market, setMarket] = useState("all");
  const [subject, setSubject] = useState<"all" | "team" | "match">("all");
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

  const filtered = useMemo(() => rows.filter((r) =>
    (sport === "all" || r.sport_id === sport) &&
    (league === "all" || r.league_slug === league) &&
    (market === "all" || r.stat_key === market) &&
    (subject === "all" || (subject === "match" ? r.subject === "match" : r.subject !== "match")) &&
    r.score >= minScore &&
    (!q || `${r.home_name} ${r.away_name} ${r.team_name ?? ""}`.toLowerCase().includes(q)),
  ), [rows, sport, league, market, subject, minScore, q]);

  async function pin(r: TeamMarketRow, a: { side: "over" | "under"; line: number; odds: number; stake: number }) {
    if (!user) { router.push("/login?next=/times"); throw new Error("Entre na sua conta para fixar."); }
    await trackTeam({
      gameId: r.game_id, kind: r.subject === "match" ? "match" : "team", teamId: r.subject === "match" ? null : r.team_id,
      statKey: r.stat_key, side: a.side, line: a.line, odds: a.odds, stake: a.stake,
    });
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-5 px-4 py-6">
      <header className="flex items-center gap-2">
        <Shield className="h-5 w-5 text-sky-300" />
        <h1 className="text-lg font-bold text-white">Mercados de times e jogos</h1>
        <span className="text-sm text-slate-500">· escanteios, gols, 1º tempo, faltas, chutes, cartões…</span>
      </header>

      <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <Chip active={sport === "all"} onClick={() => { setSport("all"); setLeague("all"); setMarket("all"); }} label="Todos" count={rows.length} />
        {SPORTS.filter((s) => sportCounts[s.id]).map((s) => (
          <Chip key={s.id} active={sport === s.id} onClick={() => { setSport(s.id); setLeague("all"); setMarket("all"); }}
            label={`${s.emoji} ${s.label}`} count={sportCounts[s.id]} />
        ))}
      </nav>

      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-3">
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar time…"
            className="w-full rounded-lg border border-line bg-bg py-2 pl-9 pr-3 text-sm outline-none focus:border-sky-400" />
        </div>
        <Select value={league} onChange={setLeague} options={[["all", "Todas as ligas"], ...leagues.map((l) => [l, leagueName(l)] as [string, string])]} />
        <Select value={market} onChange={setMarket} options={[["all", "Todos os mercados"], ...markets]} />
        <Select value={subject} onChange={(v) => setSubject(v as typeof subject)}
          options={[["all", "Time + Jogo"], ["team", "Só time"], ["match", "Só jogo (total)"]]} />
        <label className="flex items-center gap-2 text-sm text-slate-300">
          Score ≥ <b className="w-7 tabular-nums">{minScore}</b>
          <input type="range" min={0} max={90} step={5} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} className="accent-sky-400" />
        </label>
      </section>

      {error && <p className="text-sm text-rose-300">Erro: {error}</p>}
      {loading && <p className="text-sm text-slate-400">Carregando…</p>}
      {!loading && !filtered.length && (
        <p className="rounded-xl border border-line bg-surface p-10 text-center text-sm text-slate-400">
          Nenhum mercado com esses filtros. Tente baixar o score mínimo.
        </p>
      )}

      <ul className="space-y-2">
        {filtered.slice(0, limit).map((r) => {
          const k = key(r);
          const isMatch = r.subject === "match";
          return (
            <li key={k} className="rounded-xl border border-line bg-surface">
              <button onClick={() => setOpen((o) => (o === k ? null : k))} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02]">
                <TeamLogo src={isMatch ? r.home_logo : r.team_logo} alt={isMatch ? r.home_name : r.team_name ?? ""} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-100">
                    {isMatch ? `${r.home_name} x ${r.away_name}` : r.team_name}
                    {!isMatch && <span className="ml-1 text-xs font-normal text-slate-500">{r.subject === "home" ? "🏠 vs" : "✈️ @"} {r.subject === "home" ? r.away_abbr : r.home_abbr}</span>}
                  </p>
                  <p className="truncate text-xs text-slate-400">{kickoff(r.start_time)} · {leagueName(r.league_slug)}</p>
                </div>
                <div className="hidden text-right sm:block">
                  <p className="text-sm">
                    <span className={clsx("mr-1 rounded px-1.5 py-0.5 text-[11px] font-bold uppercase", r.default_side === "over" ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300")}>
                      {r.default_side === "over" ? "Mais" : "Menos"}
                    </span>
                    <b className="tabular-nums text-white">{Number(r.default_line)}</b>{" "}
                    <span className="text-slate-300">{r.stat_label}{isMatch ? " (jogo)" : ""}</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    L10 {r.hit_l10 != null ? `${Math.round(Number(r.hit_l10) * 100)}%` : "—"} · proj. {r.projection != null ? Number(r.projection).toFixed(1) : "—"}
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
        <button onClick={() => setLimit((l) => l + PAGE)} className="w-full rounded-xl border border-line py-3 text-sm text-sky-300 hover:bg-white/[0.03]">
          Carregar mais ({filtered.length - limit})
        </button>
      )}
    </div>
  );
}

function Chip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button onClick={onClick} className={clsx("flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm",
      active ? "border-sky-400 bg-sky-500/15 text-sky-200" : "border-line text-slate-300 hover:border-slate-500")}>
      {label}<span className="rounded-full bg-white/5 px-1.5 text-[11px] tabular-nums">{count}</span>
    </button>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-sky-400">
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}
