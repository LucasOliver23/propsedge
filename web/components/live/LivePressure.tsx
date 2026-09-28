"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { BellRing, Flame } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { leagueName } from "@/lib/leagues";
import type { LiveAlertRow, LiveGameRow, LiveTeamState } from "@/lib/types";
import { TeamLogo } from "@/components/teams/Widgets";

/**
 * Jogos de futebol AO VIVO com índice de pressão (chutes no gol, chutes e escanteios dos últimos ~15 min)
 * e o feed de ALERTAS de entrada. Tudo em tempo real via Supabase Realtime (live_game_state / live_alerts).
 */
export function LivePressure() {
  const [games, setGames] = useState<LiveGameRow[]>([]);
  const [alerts, setAlerts] = useState<LiveAlertRow[]>([]);
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const load = useCallback(async () => {
    const sb = getSupabase();
    const [g, a] = await Promise.all([
      sb.from("v_live_games").select("*").eq("sport_id", "soccer").order("start_time"),
      sb.from("v_live_alerts").select("*").order("created_at", { ascending: false }).limit(40),
    ]);
    setGames((g.data ?? []) as LiveGameRow[]);
    setAlerts((a.data ?? []) as LiveAlertRow[]);
  }, []);

  useEffect(() => {
    load();
    const sb = getSupabase();
    const soon = () => { clearTimeout(timer.current); timer.current = setTimeout(load, 1500); };
    const ch = sb.channel("live-pressure")
      .on("postgres_changes", { event: "*", schema: "public", table: "live_game_state" }, soon)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "live_alerts" }, (p) => {
        const id = (p.new as { id: number }).id;
        setFresh((f) => new Set(f).add(id));
        setTimeout(() => setFresh((f) => { const n = new Set(f); n.delete(id); return n; }), 8000);
        soon();
      })
      .subscribe();
    const poll = setInterval(load, 60_000);   // garantia caso o WebSocket caia
    return () => { clearTimeout(timer.current); clearInterval(poll); sb.removeChannel(ch); };
  }, [load]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 pt-6">
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-slate-100">
          <BellRing className="h-5 w-5 text-amber-300" /> Alertas ao vivo
        </h2>
        {!alerts.length ? (
          <p className="rounded-xl border border-line bg-surface p-5 text-sm text-slate-400">
            Nenhum alerta nas últimas horas. Eles aparecem quando um jogo de futebol ao vivo entra num padrão:
            gol maduro, pressão no 1º tempo, escanteios em ritmo alto ou time perdendo e pressionando.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {alerts.map((a) => (
              <li key={a.id} className={clsx("rounded-xl border bg-surface p-3 transition",
                fresh.has(a.id) ? "border-amber-400/60 shadow-[0_0_0_3px_rgba(251,191,36,.15)]" : "border-line",
                a.game_status !== "live" && "opacity-60")}>
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 font-semibold text-amber-200"><Flame className="h-4 w-4" />{a.title}</p>
                  <span className="text-xs tabular-nums text-slate-400">
                    {a.minute != null ? `${Math.round(Number(a.minute))}'` : ""} · {new Date(a.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-200">
                  {a.home_name} <b className="tabular-nums">{a.home_score ?? 0} x {a.away_score ?? 0}</b> {a.away_name}
                  <span className="ml-1 text-xs text-slate-500">{leagueName(a.league_slug)}</span>
                </p>
                <p className="mt-1 text-xs text-slate-400">{a.message}</p>
                {a.market && <p className="mt-2 inline-block rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-300">Sugestão: {a.market}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Futebol ao vivo · pressão</h2>
        {!games.length ? (
          <p className="rounded-xl border border-line bg-surface p-5 text-sm text-slate-400">Nenhum jogo de futebol em andamento agora.</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {games.map((g) => <PressureCard key={g.game_id} g={g} />)}
          </ul>
        )}
        <p className="mt-2 text-xs text-slate-500">
          Pressão 0-100 = chutes no gol (x3), chutes para fora (x1) e escanteios (x1,5) nos últimos ~15 min.
          Atualiza a cada 15 min pelo GitHub; com o worker ao vivo ligado, a cada ~1 min.
        </p>
      </section>
    </div>
  );
}

function PressureCard({ g }: { g: LiveGameRow }) {
  const h = g.data?.home, a = g.data?.away;
  const hp = Number(g.home_pressure ?? 0), ap = Number(g.away_pressure ?? 0);
  return (
    <li className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>{leagueName(g.league_slug)}</span>
        <span className="rounded bg-rose-500/15 px-1.5 py-0.5 font-bold text-rose-300">{g.clock ?? "Ao vivo"}</span>
      </div>
      <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <span className="flex min-w-0 items-center gap-2 font-semibold text-slate-100">
          <TeamLogo src={g.home_logo} alt={g.home_name} size={26} /><span className="truncate">{g.home_name}</span>
        </span>
        <span className="text-2xl font-black tabular-nums text-white">{g.home_score ?? 0} x {g.away_score ?? 0}</span>
        <span className="flex min-w-0 items-center justify-end gap-2 font-semibold text-slate-100">
          <span className="truncate">{g.away_name}</span><TeamLogo src={g.away_logo} alt={g.away_name} size={26} />
        </span>
      </div>
      <div className="mt-3 space-y-1.5">
        <Bar label={g.home_abbr ?? "Casa"} value={hp} />
        <Bar label={g.away_abbr ?? "Fora"} value={ap} />
      </div>
      {(h || a) && (
        <div className="mt-3 grid grid-cols-4 gap-1 text-center text-[11px] text-slate-400">
          <Stat label="Chutes" h={h} a={a} k="shots" />
          <Stat label="No gol" h={h} a={a} k="sot" />
          <Stat label="Escanteios" h={h} a={a} k="corners" />
          <Stat label="Posse" h={h} a={a} k="possession" suffix="%" />
        </div>
      )}
    </li>
  );
}

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-10 shrink-0 text-slate-400">{label}</span>
      <span className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-white/10">
        <span className={clsx("absolute inset-y-0 left-0 rounded-full transition-[width] duration-700",
          value >= 60 ? "bg-rose-500" : value >= 35 ? "bg-amber-400" : "bg-emerald-500")} style={{ width: `${Math.min(100, value)}%` }} />
      </span>
      <b className="w-8 text-right tabular-nums text-slate-200">{Math.round(value)}</b>
    </div>
  );
}

function Stat({ label, h, a, k, suffix = "" }: { label: string; h?: LiveTeamState; a?: LiveTeamState; k: keyof LiveTeamState; suffix?: string }) {
  const f = (s?: LiveTeamState) => (s && s[k] != null ? `${Math.round(Number(s[k]))}${suffix}` : "—");
  return (
    <div className="rounded-lg bg-bg/60 py-1.5">
      <p>{label}</p>
      <p className="font-semibold tabular-nums text-slate-200">{f(h)} · {f(a)}</p>
    </div>
  );
}
