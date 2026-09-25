"use client";

import { memo } from "react";
import clsx from "clsx";
import { ChevronDown, Flame, TrendingUp } from "lucide-react";
import { BOOK_LABELS } from "@/lib/constants";
import { kickoff, odds as fmtOdds, pct, signedPct } from "@/lib/format";
import type { PropRow } from "@/lib/types";
import { ConfidenceBar } from "./ConfidenceBar";
import { DvpBadge, HitRate } from "./HitRate";
import { L10Chart } from "./L10Chart";
import { OddsComparison } from "./OddsComparison";
import { PinButton } from "./PinButton";

export const GRID =
  "md:grid md:grid-cols-[minmax(170px,2fr)_minmax(120px,1.3fr)_repeat(4,50px)_52px_128px_84px_72px_40px_24px] md:items-center md:gap-3";

interface Props {
  row: PropRow;
  expanded: boolean;
  pinned: boolean;
  defaultStake: number;
  onToggle: () => void;
  onPin: (stake: number) => Promise<void>;
}

function PropRowItemBase({ row, expanded, pinned, defaultStake, onToggle, onPin }: Props) {
  const started = row.game_status !== "scheduled";
  const isEv = row.ev != null && row.ev >= 0.03;

  return (
    <li className={clsx("border-b border-line/70 last:border-0", expanded && "bg-white/[0.02]")}>
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onToggle()}
        className={clsx(GRID, "cursor-pointer px-4 py-3 transition hover:bg-white/[0.03]")}
      >
        {/* Jogador */}
        <div className="flex items-center gap-3">
          <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-elevated">
            {row.headshot_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={row.headshot_url} alt="" className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <span className="flex h-full items-center justify-center text-sm font-bold text-slate-400">
                {row.player_name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
              </span>
            )}
            {row.game_status === "live" && (
              <span className="absolute right-0 top-0 h-2.5 w-2.5 animate-pulse rounded-full bg-rose-500 ring-2 ring-surface" />
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate font-semibold text-slate-100">
              {row.player_name}
              {row.player_status === "questionable" && <span className="ml-1 text-xs text-amber-300">(Q)</span>}
            </p>
            <p className="truncate text-xs text-slate-400">
              {row.position ?? ""} · {row.team_abbr} {row.is_home ? "vs" : "@"} {row.opp_abbr} · {kickoff(row.start_time)}
            </p>
          </div>
        </div>

        {/* Prop */}
        <div className="mt-2 flex items-center gap-2 md:mt-0">
          <span
            className={clsx(
              "rounded-md px-1.5 py-0.5 text-[11px] font-bold uppercase",
              row.side === "over" ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300",
            )}
          >
            {row.side === "over" ? "Mais" : "Menos"}
          </span>
          <span className="font-semibold tabular-nums text-slate-100">{row.line}</span>
          <span className="truncate text-sm text-slate-400">{row.stat_label ?? row.stat_key}</span>
        </div>

        {/* L5 / L10 / L20 / H2H */}
        <div className="mt-3 grid grid-cols-4 gap-2 md:contents">
          <HitRate label="L5" hits={row.l5_hits} n={row.l5_n} />
          <HitRate label="L10" hits={row.l10_hits} n={row.l10_n} />
          <HitRate label="L20" hits={row.l20_hits} n={row.l20_n} />
          <HitRate label="H2H" hits={row.h2h_hits} n={row.h2h_n} />
        </div>

        {/* DvP, confiança, odds, EV, fixar */}
        <div className="mt-3 flex items-center justify-between gap-3 md:contents">
          <div className="flex justify-center"><DvpBadge rank={row.dvp_rank} factor={row.dvp_factor} /></div>
          <ConfidenceBar value={row.confidence} />
          <div className="text-right leading-tight">
            <p className="font-semibold tabular-nums text-slate-100">{fmtOdds(row.best_odds)}</p>
            <p className="text-[11px] text-slate-500">{row.best_book ? BOOK_LABELS[row.best_book] ?? row.best_book : ""}</p>
          </div>
          <div className="text-right">
            {row.ev == null ? (
              <span className="text-xs text-slate-600">Pro</span>
            ) : (
              <span
                className={clsx(
                  "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-bold tabular-nums",
                  isEv ? "bg-emerald-500/15 text-emerald-300" : row.ev > 0 ? "text-slate-300" : "text-slate-500",
                )}
              >
                {isEv && <Flame className="h-3 w-3" />}
                {signedPct(row.ev)}
              </span>
            )}
          </div>
          <PinButton pinned={pinned} disabled={started} defaultStake={defaultStake} onConfirm={onPin} />
          <ChevronDown className={clsx("hidden h-4 w-4 text-slate-500 transition md:block", expanded && "rotate-180")} />
        </div>
      </div>

      {expanded && (
        <div className="grid gap-6 px-4 pb-5 pt-1 md:grid-cols-[1.6fr_1fr_1fr]">
          <L10Chart values={row.l10_values} opponents={row.l10_opps} line={row.line} side={row.side} />
          <OddsComparison books={row.books} line={row.line} fairProb={row.fair_prob} />
          <dl className="grid grid-cols-2 content-start gap-x-4 gap-y-3 text-sm">
            <Stat label="Média temporada" value={row.season_avg?.toFixed(1)} />
            <Stat label="Projeção" value={row.proj_mean?.toFixed(1)} icon />
            <Stat label="Prob. modelo" value={pct(row.model_prob, 1)} />
            <Stat label="Prob. justa" value={row.fair_prob == null ? "Pro" : pct(row.fair_prob, 1)} />
            <Stat
              label="DvP"
              value={row.dvp_factor == null ? "—" : `${row.dvp_factor > 1 ? "+" : ""}${((row.dvp_factor - 1) * 100).toFixed(0)}% vs média`}
            />
            <Stat label="Atualizado" value={new Date(row.computed_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} />
          </dl>
        </div>
      )}
    </li>
  );
}

function Stat({ label, value, icon }: { label: string; value?: string | null; icon?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="flex items-center gap-1 font-semibold tabular-nums text-slate-200">
        {icon && <TrendingUp className="h-3.5 w-3.5 text-sky-300" />}
        {value ?? "—"}
      </dd>
    </div>
  );
}

export const PropRowItem = memo(PropRowItemBase);
