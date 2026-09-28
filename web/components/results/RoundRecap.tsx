"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Trophy } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { SPORTS } from "@/lib/constants";
import type { PickRecapRow } from "@/lib/types";
import { ShareButton } from "@/components/share/ShareButton";
import { RecapArt } from "@/components/share/ShareArt";

const SUBJECT_LABEL: Record<string, string> = { home: "Mandante", away: "Visitante", match: "Jogo" };

/** "Mercados que se destacaram": resultado dos picks automáticos do dia (score ≥ 65), liquidados sozinhos. */
export function RoundRecap() {
  const [rows, setRows] = useState<PickRecapRow[]>([]);
  const [day, setDay] = useState<string | null>(null);
  const [sport, setSport] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const since = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
    getSupabase().from("v_picks_recap").select("*").gte("dia", since).then(({ data }) => {
      const r = (data ?? []) as PickRecapRow[];
      setRows(r);
      const days = Array.from(new Set(r.map((x) => x.dia))).sort().reverse();
      setDay(days[0] ?? null);
      setLoading(false);
    });
  }, []);

  const days = useMemo(() => Array.from(new Set(rows.map((x) => x.dia))).sort().reverse(), [rows]);
  const dayRows = rows.filter((r) => r.dia === day && (sport === "all" || r.sport_id === sport));
  const sportsOfDay = Array.from(new Set(rows.filter((r) => r.dia === day).map((r) => r.sport_id)));

  const markets = useMemo(() => {
    const m = new Map<string, { label: string; entries: number; greens: number }>();
    for (const r of dayRows) {
      const k = `${r.stat_key}:${r.subject}`;
      const cur = m.get(k) ?? { label: `${r.stat_label} (${SUBJECT_LABEL[r.subject]})`, entries: 0, greens: 0 };
      cur.entries += r.entries; cur.greens += r.greens;
      m.set(k, cur);
    }
    return Array.from(m.values()).sort((a, b) => b.greens / b.entries - a.greens / a.entries || b.entries - a.entries);
  }, [dayRows]);

  const total = dayRows.reduce((s, r) => s + r.entries, 0);
  const greens = dayRows.reduce((s, r) => s + r.greens, 0);
  const hr = total ? greens / total : 0;

  if (loading) return <p className="p-10 text-center text-slate-400">Carregando…</p>;
  if (!days.length)
    return (
      <div className="mx-auto mt-20 max-w-md text-center text-slate-400">
        <Trophy className="mx-auto mb-3 h-8 w-8" />
        Ainda não há rodadas liquidadas. Os picks do dia são salvos antes dos jogos (score ≥ 65) e aparecem aqui depois que terminam.
      </div>
    );

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-lg font-bold text-white">Resultados da rodada</h1>
        {day && total > 0 && (
          <ShareButton filename={`propsedge-rodada-${day}`} render={(format) => (
            <RecapArt format={format} markets={markets} total={total} greens={greens}
              dayLabel={new Date(day + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" })} />
          )} />
        )}
        <select value={day ?? ""} onChange={(e) => setDay(e.target.value)} className="rounded-lg border border-line bg-bg px-3 py-2 text-sm">
          {days.map((d) => <option key={d} value={d}>{new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" })}</option>)}
        </select>
        <select value={sport} onChange={(e) => setSport(e.target.value)} className="rounded-lg border border-line bg-bg px-3 py-2 text-sm">
          <option value="all">Todos os esportes</option>
          {sportsOfDay.map((s) => <option key={s} value={s}>{SPORTS.find((x) => x.id === s)?.label ?? s}</option>)}
        </select>
      </div>

      <div className="grid gap-5 md:grid-cols-[280px_1fr]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-b from-emerald-500/10 to-surface p-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-300">Mercados que</p>
            <p className="text-4xl font-black leading-none text-white">se <span className="text-emerald-400">destacaram</span></p>
            <p className="mt-3 text-sm text-slate-400">Picks automáticos do PropsEdge (score ≥ 65), conferidos com o resultado oficial.</p>
          </div>
          <div className="rounded-2xl border border-line bg-surface p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Overall da rodada</p>
            <div className="mt-3 grid grid-cols-4 text-center">
              <Stat label="Entradas" value={total} />
              <Stat label="Green" value={greens} tone="text-emerald-400" />
              <Stat label="Red" value={total - greens} tone="text-rose-400" />
              <Stat label="Hit rate" value={`${Math.round(hr * 100)}%`} tone={hr >= 0.6 ? "text-emerald-300" : "text-amber-300"} />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-surface">
          <div className="grid grid-cols-[1fr_90px_140px] border-b border-line px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <span>Mercado</span><span className="text-center">Entradas</span><span>Hit rate</span>
          </div>
          <ul>
            {markets.map((m) => {
              const r = m.greens / m.entries;
              return (
                <li key={m.label} className="grid grid-cols-[1fr_90px_140px] items-center border-b border-line/60 px-4 py-3 last:border-0">
                  <span className="font-semibold text-slate-100">{m.label}</span>
                  <span className="text-center text-sm tabular-nums text-slate-300"><b className="text-emerald-300">{m.greens}</b> de {m.entries}</span>
                  <span>
                    <span className={clsx("text-lg font-bold tabular-nums", r >= 0.7 ? "text-emerald-300" : r >= 0.55 ? "text-amber-300" : "text-rose-400")}>{Math.round(r * 100)}%</span>
                    <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-white/10">
                      <span className={clsx("block h-full rounded-full", r >= 0.7 ? "bg-emerald-400" : r >= 0.55 ? "bg-amber-400" : "bg-rose-500")} style={{ width: `${r * 100}%` }} />
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <p className="text-center text-xs text-slate-500">+18 · Jogue com responsabilidade. Aposta não é investimento.</p>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase text-slate-500">{label}</p>
      <p className={clsx("text-xl font-bold tabular-nums", tone ?? "text-white")}>{value}</p>
    </div>
  );
}
