"use client";

import { useState } from "react";
import clsx from "clsx";
import { ChevronUp, Layers, X } from "lucide-react";
import { odds as fmtOdds, pct } from "@/lib/format";
import type { PropRow } from "@/lib/types";

/**
 * Montador de combinadas ("Múltiplas" do PropsBR): mostra prob. combinada e
 * odd justa combinada das props selecionadas, assumindo independência entre
 * elas (simplificação padrão — jogos/mercados diferentes tendem a ser ~independentes;
 * props do mesmo jogo podem ser correlacionadas, por isso mostramos um aviso).
 */
export function MultiplesBar({ legs, onRemove, onClear }: { legs: PropRow[]; onRemove: (key: string) => void; onClear: () => void }) {
  const [open, setOpen] = useState(true);
  if (legs.length === 0) return null;

  const sameGame = new Set(legs.map((l) => l.game_id)).size !== legs.length;
  const probs = legs.map((l) => Number(l.model_prob ?? 0));
  const combinedProb = probs.reduce((a, b) => a * b, 1);
  const combinedFairOdd = combinedProb > 0 ? 1 / combinedProb : null;
  const oddsLegs = legs.filter((l) => l.best_odds != null);
  const combinedBookOdd = oddsLegs.length === legs.length
    ? legs.reduce((a, l) => a * Number(l.best_odds), 1)
    : null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-elevated/95 shadow-2xl backdrop-blur">
      <div className="mx-auto max-w-[1400px] px-4">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-3 py-2.5 text-sm font-semibold text-slate-100"
        >
          <span className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-violet-300" />
            Múltipla · {legs.length} {legs.length === 1 ? "prop" : "props"}
            {combinedFairOdd && (
              <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-xs font-bold text-violet-200">
                odd justa {fmtOdds(combinedFairOdd)}
              </span>
            )}
          </span>
          <ChevronUp className={clsx("h-4 w-4 text-slate-400 transition", !open && "rotate-180")} />
        </button>

        {open && (
          <div className="space-y-3 pb-4">
            {sameGame && (
              <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-1.5 text-xs text-amber-200">
                Duas ou mais props são do mesmo jogo — elas podem estar correlacionadas, então a probabilidade
                combinada abaixo (que assume independência) tende a ser otimista.
              </p>
            )}
            <ul className="flex flex-wrap gap-2">
              {legs.map((l) => {
                const key = `${l.market_id}:${l.side}`;
                return (
                  <li
                    key={key}
                    className="flex items-center gap-2 rounded-lg border border-line bg-bg/60 px-2.5 py-1.5 text-xs"
                  >
                    <span className="text-slate-200">
                      {l.player_name} <b className={l.side === "over" ? "text-emerald-300" : "text-rose-300"}>{l.side === "over" ? "Mais" : "Menos"} {l.line}</b>{" "}
                      <span className="text-slate-500">{l.stat_label ?? l.stat_key}</span>
                    </span>
                    <span className="tabular-nums text-slate-400">{pct(l.model_prob, 0)}</span>
                    <button onClick={() => onRemove(key)} className="text-slate-500 hover:text-rose-300" aria-label="Remover">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
              <span className="text-slate-400">
                Prob. combinada: <b className="tabular-nums text-slate-100">{pct(combinedProb, 1)}</b>
              </span>
              <span className="text-slate-400">
                Odd justa combinada: <b className="tabular-nums text-violet-200">{fmtOdds(combinedFairOdd)}</b>
              </span>
              {combinedBookOdd != null && (
                <span className="text-slate-400">
                  Odd combinada (melhores casas): <b className="tabular-nums text-slate-100">{fmtOdds(combinedBookOdd)}</b>
                </span>
              )}
              <button onClick={onClear} className="ml-auto text-xs text-slate-500 hover:text-rose-300">
                Limpar tudo
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
