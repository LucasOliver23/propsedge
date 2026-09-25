"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { Trash2 } from "lucide-react";
import { useTrackedBets } from "@/hooks/useTrackedBets";
import { BOOK_LABELS } from "@/lib/constants";
import { brl, kickoff } from "@/lib/format";
import type { BetStatus } from "@/lib/types";

const STATUS: Record<BetStatus, { label: string; cls: string }> = {
  pending: { label: "Pendente", cls: "bg-white/5 text-slate-300" },
  live: { label: "Ao vivo", cls: "bg-rose-500/15 text-rose-300" },
  green: { label: "Green", cls: "bg-emerald-500/15 text-emerald-300" },
  red: { label: "Red", cls: "bg-rose-600/20 text-rose-300" },
  push: { label: "Devolvida", cls: "bg-slate-500/20 text-slate-300" },
  void: { label: "Anulada", cls: "bg-slate-500/20 text-slate-400" },
};

/** Bilheteira: bankroll, ROI e todas as props fixadas (liquidação 100% automática no banco). */
export function BetSlip() {
  const { profile, bets, untrack } = useTrackedBets();
  const [filter, setFilter] = useState<"all" | "open" | "settled">("all");
  const [err, setErr] = useState<string | null>(null);

  const summary = useMemo(() => {
    const settled = bets.filter((b) => b.status === "green" || b.status === "red");
    const staked = settled.reduce((s, b) => s + Number(b.stake), 0);
    const profit = bets.reduce((s, b) => s + Number(b.profit ?? 0), 0);
    const greens = settled.filter((b) => b.status === "green").length;
    return {
      greens, reds: settled.length - greens, profit,
      roi: staked ? profit / staked : 0,
      winRate: settled.length ? greens / settled.length : 0,
    };
  }, [bets]);

  const list = bets.filter((b) =>
    filter === "all" ? true : filter === "open" ? ["pending", "live"].includes(b.status) : !["pending", "live"].includes(b.status),
  );

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card label="Bankroll" value={profile ? brl(Number(profile.bankroll)) : "—"} />
        <Card label="Lucro" value={brl(summary.profit)} tone={summary.profit >= 0 ? "text-emerald-300" : "text-rose-300"} />
        <Card label="ROI" value={`${(summary.roi * 100).toFixed(1)}%`} tone={summary.roi >= 0 ? "text-emerald-300" : "text-rose-300"} />
        <Card label="Green / Red" value={`${summary.greens} / ${summary.reds}`} sub={`${(summary.winRate * 100).toFixed(0)}% acerto`} />
      </section>

      <div className="flex gap-2">
        {(["all", "open", "settled"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={clsx("rounded-full border px-3 py-1 text-sm", filter === f ? "border-sky-400 bg-sky-500/15 text-sky-200" : "border-line text-slate-400")}>
            {f === "all" ? "Todas" : f === "open" ? "Abertas" : "Liquidadas"}
          </button>
        ))}
      </div>
      {err && <p className="text-sm text-rose-300">{err}</p>}

      <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
        {!list.length && <li className="p-8 text-center text-sm text-slate-400">Nada por aqui ainda.</li>}
        {list.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <span className={clsx("w-20 rounded-md py-0.5 text-center text-[11px] font-bold uppercase", STATUS[b.status].cls)}>
              {STATUS[b.status].label}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-slate-100">
                {b.player_name} · {b.side === "over" ? "Mais" : "Menos"} {b.line} {b.stat_label ?? b.stat_key}
              </p>
              <p className="text-xs text-slate-400">
                {b.away_abbr} @ {b.home_abbr} · {kickoff(b.start_time)} · @{Number(b.odds).toFixed(2)}{" "}
                {b.bookmaker_id ? `(${BOOK_LABELS[b.bookmaker_id] ?? b.bookmaker_id})` : ""}
                {b.result_value != null && <> · resultado <b className="text-slate-200">{b.result_value}</b></>}
              </p>
            </div>
            <div className="text-right text-sm tabular-nums">
              <p className="text-slate-300">{brl(Number(b.stake))}</p>
              {b.profit != null && (
                <p className={clsx("font-semibold", b.profit > 0 ? "text-emerald-300" : b.profit < 0 ? "text-rose-300" : "text-slate-400")}>
                  {b.profit > 0 ? "+" : ""}{brl(Number(b.profit))}
                </p>
              )}
            </div>
            {b.status === "pending" && b.game_status === "scheduled" && (
              <button
                aria-label="Desafixar"
                onClick={() => untrack(b.id).catch((e: Error) => setErr(e.message))}
                className="rounded-lg p-2 text-slate-500 hover:bg-white/5 hover:text-rose-300"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Card({ label, value, tone, sub }: { label: string; value: string; tone?: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={clsx("mt-1 text-xl font-bold tabular-nums", tone ?? "text-slate-100")}>{value}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </div>
  );
}
