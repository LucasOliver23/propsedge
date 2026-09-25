"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { CheckCircle2, Radio, XCircle } from "lucide-react";
import { useTrackedBets } from "@/hooks/useTrackedBets";
import { getSupabase } from "@/lib/supabase/client";
import { brl } from "@/lib/format";
import type { TrackedBet } from "@/lib/types";

type LiveStats = Record<string, Record<string, number>>;            // `${game}:${player}` -> stats
type LiveGame = { period: string | null; clock: string | null; home_score: number | null; away_score: number | null; status: string };

/**
 * LIVE TRACKER
 * - Assina `live_player_stats` e `games` filtrando só os jogos das apostas abertas do usuário.
 * - O worker grava a cada ~20s; o Supabase Realtime entrega via WebSocket (sem polling no browser).
 * - Quando o jogo termina, o trigger no Postgres liquida e `tracked_bets` muda para green/red —
 *   o hook useTrackedBets recebe esse evento e o card "vira" sozinho.
 */
export function LiveTracker() {
  const { bets, ready } = useTrackedBets();
  const open = useMemo(() => bets.filter((b) => b.status === "live" || b.status === "pending"), [bets]);
  const recent = useMemo(
    () => bets.filter((b) => ["green", "red", "push", "void"].includes(b.status)).slice(0, 12),
    [bets],
  );
  const gameIds = useMemo(() => Array.from(new Set(open.map((b) => b.game_id))).sort(), [open]);

  const [stats, setStats] = useState<LiveStats>({});
  const [games, setGames] = useState<Record<number, LiveGame>>({});
  const [flash, setFlash] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!gameIds.length) return;
    const supabase = getSupabase();
    const inList = `(${gameIds.join(",")})`;

    // estado inicial
    supabase.from("live_player_stats").select("game_id,player_id,stats").in("game_id", gameIds).then(({ data }) => {
      const s: LiveStats = {};
      data?.forEach((r) => (s[`${r.game_id}:${r.player_id}`] = r.stats));
      setStats(s);
    });
    supabase.from("games").select("id,period,clock,home_score,away_score,status").in("id", gameIds).then(({ data }) => {
      const g: Record<number, LiveGame> = {};
      data?.forEach((r) => (g[r.id] = r));
      setGames(g);
    });

    // tempo real
    const ch = supabase
      .channel(`live-${gameIds.join("-")}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "live_player_stats", filter: `game_id=in.${inList}` },
        (p) => {
          const r = p.new as { game_id: number; player_id: number; stats: Record<string, number> };
          const key = `${r.game_id}:${r.player_id}`;
          setStats((s) => ({ ...s, [key]: r.stats }));
          setFlash((f) => new Set(f).add(key));
          setTimeout(() => setFlash((f) => { const n = new Set(f); n.delete(key); return n; }), 1200);
        })
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "games", filter: `id=in.${inList}` },
        (p) => {
          const r = p.new as LiveGame & { id: number };
          setGames((g) => ({ ...g, [r.id]: r }));
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [gameIds]);

  if (ready && !open.length && !recent.length) {
    return <Empty />;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-6">
      <section>
        <h1 className="mb-3 flex items-center gap-2 text-lg font-bold text-slate-100">
          <Radio className="h-5 w-5 animate-pulse text-rose-400" /> Ao vivo e próximas
        </h1>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {open.map((b) => {
            const key = `${b.game_id}:${b.player_id}`;
            const current = stats[key]?.[b.stat_key] ?? b.live_value ?? 0;
            return <LiveCard key={b.id} bet={b} current={Number(current)} game={games[b.game_id]} flash={flash.has(key)} />;
          })}
        </div>
      </section>

      {!!recent.length && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Liquidadas recentemente</h2>
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
            {recent.map((b) => (
              <li key={b.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="flex items-center gap-2">
                  {b.status === "green" ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> :
                   b.status === "red" ? <XCircle className="h-4 w-4 text-rose-400" /> :
                   <span className="h-4 w-4 rounded-full bg-slate-600" />}
                  {b.player_name} · {b.side === "over" ? "Mais" : "Menos"} {b.line} {b.stat_label}
                </span>
                <span className="tabular-nums text-slate-400">
                  {b.result_value ?? "—"} ·{" "}
                  <b className={clsx(b.profit! > 0 ? "text-emerald-300" : b.profit! < 0 ? "text-rose-300" : "text-slate-300")}>
                    {brl(Number(b.profit ?? 0))}
                  </b>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function LiveCard({ bet, current, game, flash }: { bet: TrackedBet; current: number; game?: LiveGame; flash: boolean }) {
  const isLive = (game?.status ?? bet.game_status) === "live";
  const target = bet.line;
  const progress = Math.min(100, (current / Math.max(target, 0.5)) * 100);
  const hitting = bet.side === "over" ? current > target : current < target;

  return (
    <article className={clsx("rounded-xl border bg-surface p-4", flash && "animate-flash",
      isLive ? (hitting ? "border-emerald-500/40" : "border-line") : "border-line opacity-80")}>
      <header className="flex items-start justify-between">
        <div>
          <p className="font-semibold text-slate-100">{bet.player_name}</p>
          <p className="text-xs text-slate-400">
            {bet.side === "over" ? "Mais de" : "Menos de"} {bet.line} {bet.stat_label ?? bet.stat_key} · @{Number(bet.odds).toFixed(2)}
          </p>
        </div>
        <span className={clsx("rounded-md px-2 py-0.5 text-[11px] font-bold uppercase",
          isLive ? "bg-rose-500/15 text-rose-300" : "bg-white/5 text-slate-400")}>
          {isLive ? `${game?.period ?? ""} ${game?.clock ?? ""}`.trim() || "Ao vivo" : "Pré-jogo"}
        </span>
      </header>

      <div className="mt-4 flex items-end justify-between">
        <span className={clsx("text-3xl font-black tabular-nums", hitting ? "text-emerald-300" : "text-slate-100")}>{current}</span>
        <span className="text-sm text-slate-500">/ {target}</span>
      </div>
      <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-white/10">
        <span className={clsx("block h-full rounded-full transition-[width] duration-700",
          hitting ? "bg-emerald-500" : bet.side === "under" ? "bg-sky-500" : "bg-amber-400")} style={{ width: `${progress}%` }} />
      </div>

      <footer className="mt-3 flex justify-between text-xs text-slate-400">
        <span>{bet.away_abbr} {game?.away_score ?? bet.away_score ?? "-"} x {game?.home_score ?? bet.home_score ?? "-"} {bet.home_abbr}</span>
        <span>Stake {brl(Number(bet.stake))}</span>
      </footer>
    </article>
  );
}

function Empty() {
  return (
    <div className="mx-auto mt-24 max-w-md text-center text-slate-400">
      <Radio className="mx-auto mb-3 h-8 w-8" />
      Nenhuma aposta fixada. Fixe props no painel para acompanhá-las ao vivo aqui.
    </div>
  );
}
