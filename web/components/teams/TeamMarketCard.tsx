"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { Loader2, Minus, Pin, Plus } from "lucide-react";
import { leagueName } from "@/lib/leagues";
import { kickoff, signedPct } from "@/lib/format";
import { ev as calcEv, grade as calcGrade, hitRate, teamScore } from "@/lib/teamEngine";
import type { SeriesPoint, Side, TeamMarketRow } from "@/lib/types";
import { GradeBadge, ScoreRing, SeriesChart, TeamLogo } from "./Widgets";
import { ShareButton } from "@/components/share/ShareButton";
import { MarketArt } from "@/components/share/ShareArt";

type Win = "l5" | "l10" | "l20" | "h2h" | "venue" | "season";

interface Props {
  row: TeamMarketRow;
  defaultStake: number;
  onPin: (a: { side: Side; line: number; odds: number; stake: number }) => Promise<void>;
}

/** Card completo de um mercado de time/jogo, com linha ajustável e recálculo na hora. */
export function TeamMarketCard({ row, defaultStake, onPin }: Props) {
  const [line, setLine] = useState(Number(row.default_line));
  const [side, setSide] = useState<Side>(row.default_side);
  const [win, setWin] = useState<Win>("l10");
  const [odd, setOdd] = useState("");
  const [stake, setStake] = useState(defaultStake);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const d = row.data;
  const isMatch = row.subject === "match";
  const isYesNo = row.stat_key === "btts";            // Ambas marcam: linha fixa 0.5, Sim/Não
  const sideLabel = (s: Side) => (isYesNo ? (s === "over" ? "Sim" : "Não") : s === "over" ? "Mais" : "Menos");
  const step = 1;
  const projection = row.projection != null ? Number(row.projection) : null;
  const factor = row.matchup_factor != null ? Number(row.matchup_factor) : null;

  const windows: Record<Win, { label: string; pts: SeriesPoint[]; vals: number[] }> = useMemo(() => {
    const l20 = d.l20 ?? [];
    const venueLabel = isMatch ? "Casa/Fora" : row.subject === "home" ? "Casa" : "Fora";
    return {
      l5: { label: "L5", pts: l20.slice(0, 5), vals: l20.slice(0, 5).map((p) => p.v) },
      l10: { label: "L10", pts: l20.slice(0, 10), vals: l20.slice(0, 10).map((p) => p.v) },
      l20: { label: "L20", pts: l20, vals: l20.map((p) => p.v) },
      h2h: { label: "H2H", pts: d.h2h ?? [], vals: (d.h2h ?? []).map((p) => p.v) },
      venue: { label: venueLabel, pts: d.venue ?? [], vals: (d.venue ?? []).map((p) => p.v) },
      season: { label: "Temp.", pts: l20, vals: d.season ?? [] },
    };
  }, [d, isMatch, row.subject]);

  const { score, prob } = useMemo(() => teamScore(d, line, side, projection, factor), [d, line, side, projection, factor]);
  const grade = calcGrade(factor, side);
  const cur = windows[win];
  const hr = hitRate(cur.vals, line, side);
  const oddNum = Number(odd.replace(",", "."));
  const evVal = oddNum > 1 ? calcEv(prob, oddNum) : null;
  const fairOdd = prob > 0 ? 1 / prob : null;

  const title = isMatch ? `${row.home_name} x ${row.away_name}` : row.team_name ?? "";
  const logo = isMatch ? row.home_logo : row.team_logo;
  const oppName = row.subject === "home" ? row.away_name : row.home_name;

  async function pin() {
    setMsg(null);
    if (!(oddNum > 1.01)) { setMsg({ ok: false, text: "Informe a odd que você encontrou na sua casa." }); return; }
    setBusy(true);
    try {
      await onPin({ side, line, odds: oddNum, stake });
      setMsg({ ok: true, text: "Fixado na Bilheteira ✔" });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally { setBusy(false); }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-start gap-4 border-b border-line bg-gradient-to-r from-elevated to-surface p-4">
        <div className="flex items-center gap-2">
          <TeamLogo src={logo} alt={title} size={56} />
          {isMatch && <TeamLogo src={row.away_logo} alt={row.away_name} size={44} />}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-xl font-black text-white">{title}</h3>
          <p className="text-xs text-slate-400">
            🕒 {kickoff(row.start_time)} · {leagueName(row.league_slug)}
            {(row.home_rank || row.away_rank) && <> · tabela: {row.home_abbr ?? "casa"} {row.home_rank ? `${row.home_rank}º` : "—"} x {row.away_abbr ?? "fora"} {row.away_rank ? `${row.away_rank}º` : "—"}</>}
            {!isMatch && <> · {row.subject === "home" ? "🏠" : "✈️"} x {oppName}</>}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-lg border border-line text-xs font-bold">
              {(["over", "under"] as Side[]).map((s) => (
                <button key={s} onClick={() => setSide(s)}
                  className={clsx("px-2.5 py-1", side === s ? (s === "over" ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300") : "text-slate-400")}>
                  {sideLabel(s)}
                </button>
              ))}
            </div>
            <span className="font-semibold text-slate-100">{row.stat_label}{isMatch && !isYesNo ? " (jogo)" : ""}</span>
            {!isYesNo && <div className="flex items-center rounded-lg border border-line">
              <button aria-label="Diminuir linha" onClick={() => setLine((l) => Math.max(0.5, +(l - step).toFixed(1)))} className="px-2 py-1 text-slate-300 hover:text-white"><Minus className="h-3.5 w-3.5" /></button>
              <span className="w-12 text-center font-bold tabular-nums text-white">{line}</span>
              <button aria-label="Aumentar linha" onClick={() => setLine((l) => +(l + step).toFixed(1))} className="px-2 py-1 text-slate-300 hover:text-white"><Plus className="h-3.5 w-3.5" /></button>
            </div>}
          </div>
        </div>
      </div>

      {/* Números principais */}
      <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
        <div className="text-center">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">{isYesNo ? "Chance de ambas" : "Projeção"}</p>
          <p className="text-2xl font-bold tabular-nums text-emerald-300">
            {isYesNo ? (d.p_btts != null ? `${Math.round(Number(d.p_btts) * 100)}%` : "—") : projection?.toFixed(1) ?? "—"}
          </p>
          {projection != null && !isYesNo && (
            <p className="text-xs text-slate-400">{projection >= line ? "+" : ""}{(projection - line).toFixed(1)} {projection >= line ? "acima" : "abaixo"}</p>
          )}
        </div>
        <div className="text-center">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Bateu</p>
          <p className={clsx("text-2xl font-bold tabular-nums", (hr.rate ?? 0) >= 0.6 ? "text-emerald-300" : (hr.rate ?? 0) >= 0.45 ? "text-amber-300" : "text-rose-400")}>
            {hr.rate == null ? "—" : `${Math.round(hr.rate * 100)}%`}
          </p>
          <p className="text-xs text-slate-400">{hr.hits} de {hr.n} · {cur.label}</p>
        </div>
        <div className="flex justify-center">
          <ScoreRing value={score} sub={`chance ${Math.round(prob * 100)}%`} />
        </div>
        <div className="flex justify-center">
          <GradeBadge grade={grade} />
        </div>
      </div>

      {isYesNo && d.home_avg != null && d.away_avg != null && (
        <p className="-mt-2 pb-3 text-center text-sm text-slate-300">
          Gols esperados: {row.home_abbr ?? row.home_name} <b className="text-white">{Number(d.home_avg).toFixed(2)}</b> x{" "}
          <b className="text-white">{Number(d.away_avg).toFixed(2)}</b> {row.away_abbr ?? row.away_name}
          <span className="block text-xs text-slate-500">no histórico, 1 = os dois marcaram · 0 = pelo menos um passou em branco</span>
        </p>
      )}

      {isMatch && !isYesNo && d.home_avg != null && d.away_avg != null && (
        <p className="-mt-2 pb-3 text-center text-sm text-slate-300">
          {row.home_abbr ?? row.home_name} <b className="text-white">{Number(d.home_avg).toFixed(1)}</b> + {row.away_abbr ?? row.away_name}{" "}
          <b className="text-white">{Number(d.away_avg).toFixed(1)}</b> = <b className="text-emerald-300">{(Number(d.home_avg) + Number(d.away_avg)).toFixed(1)}</b>
          <span className="block text-xs text-slate-500">projeção somada dos dois times</span>
        </p>
      )}

      {/* Gráfico */}
      <div className="px-4 pb-2">
        <SeriesChart points={cur.pts} line={line} side={side} />
      </div>

      {/* Janelas */}
      <div className="grid grid-cols-6 border-t border-line">
        {(Object.keys(windows) as Win[]).map((k) => {
          const r = hitRate(windows[k].vals, line, side);
          return (
            <button key={k} onClick={() => setWin(k)}
              className={clsx("py-2.5 text-center transition", win === k ? "bg-emerald-500/10" : "hover:bg-white/[0.03]")}>
              <p className="text-[11px] text-slate-400">{windows[k].label}</p>
              <p className={clsx("text-sm font-bold tabular-nums", r.rate == null ? "text-slate-600" : r.rate >= 0.6 ? "text-emerald-300" : r.rate >= 0.45 ? "text-amber-300" : "text-rose-400")}>
                {r.rate == null ? "—" : `${Math.round(r.rate * 100)}%`}
              </p>
            </button>
          );
        })}
      </div>

      {/* Odd da casa do usuário + EV + fixar */}
      <div className="flex flex-wrap items-end gap-3 border-t border-line bg-bg/40 p-4">
        <label className="text-xs text-slate-400">
          Odd na sua casa
          <input value={odd} onChange={(e) => setOdd(e.target.value)} inputMode="decimal" placeholder="ex.: 1.72"
            className="mt-1 block w-28 rounded-lg border border-line bg-bg px-2 py-1.5 text-sm tabular-nums text-white outline-none focus:border-sky-400" />
        </label>
        <div className="text-xs text-slate-400">
          Odd justa
          <p className="mt-1 py-1.5 text-sm font-semibold tabular-nums text-slate-200">{fairOdd ? fairOdd.toFixed(2) : "—"}</p>
        </div>
        <div className="text-xs text-slate-400">
          EV
          <p className={clsx("mt-1 py-1.5 text-sm font-bold tabular-nums", evVal == null ? "text-slate-500" : evVal > 0 ? "text-emerald-300" : "text-rose-400")}>
            {evVal == null ? "digite a odd" : signedPct(evVal)}
          </p>
        </div>
        <label className="text-xs text-slate-400">
          Stake
          <input type="number" min={1} value={stake} onChange={(e) => setStake(Number(e.target.value))}
            className="mt-1 block w-20 rounded-lg border border-line bg-bg px-2 py-1.5 text-sm tabular-nums text-white outline-none focus:border-sky-400" />
        </label>
        <button onClick={pin} disabled={busy || row.game_status !== "scheduled"}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-40">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pin className="h-4 w-4" />} Fixar
        </button>
        {msg && <p className={clsx("w-full text-xs", msg.ok ? "text-emerald-300" : "text-rose-300")}>{msg.text}</p>}
        <div className="flex w-full items-center justify-between border-t border-line pt-3">
          <span className="text-xs text-slate-500">Imagem para Instagram (com a linha e a janela escolhidas)</span>
          <ShareButton
            filename={`propsedge-${(isMatch ? `${row.home_abbr}-${row.away_abbr}` : row.team_abbr ?? "time")}-${row.stat_key}-${line}`.toLowerCase()}
            render={(format) => (
              <MarketArt row={row} line={line} side={side} points={win === "season" ? (d.l20 ?? []).slice(0, 10) : cur.pts.slice(0, 10)}
                windowLabel={cur.label} projection={projection} score={score} chance={prob} grade={grade} format={format}
                windows={(Object.keys(windows) as Win[]).map((k) => {
                  const r = hitRate(windows[k].vals, line, side);
                  return { label: windows[k].label, hits: r.hits, n: r.n };
                })} />
            )}
          />
        </div>
      </div>
    </div>
  );
}
