import clsx from "clsx";
import { Lock } from "lucide-react";
import { BOOK_LABELS } from "@/lib/constants";
import { odds as fmtOdds } from "@/lib/format";
import type { BookOdds } from "@/lib/types";

export function OddsComparison({ books, line, fairProb }: { books: BookOdds[] | null; line: number; fairProb: number | null }) {
  if (books === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line p-4 text-center text-sm text-slate-400">
        <Lock className="h-4 w-4" />
        Comparador de odds e EV+ são recursos <b className="text-amber-300">Pro</b>.
      </div>
    );
  }
  const fairOdds = fairProb ? 1 / fairProb : null;
  const best = Math.max(...books.map((b) => b.odds ?? 0));

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
        <span>Comparador de odds</span>
        {fairOdds && <span>Odd justa: <b className="text-slate-200">{fairOdds.toFixed(2)}</b></span>}
      </div>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {books.map((b) => {
          const isBest = b.odds != null && b.odds === best;
          const sameLine = b.line === line;
          return (
            <li key={b.book} className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="text-slate-300">{BOOK_LABELS[b.book] ?? b.book}</span>
              <span className="flex items-center gap-3">
                {!sameLine && <span className="text-xs text-amber-300">linha {b.line}</span>}
                <span
                  className={clsx(
                    "min-w-[3.5rem] rounded-md px-2 py-0.5 text-right font-semibold tabular-nums",
                    isBest ? "bg-emerald-500/15 text-emerald-300" : "text-slate-200",
                    fairOdds && b.odds && b.odds > fairOdds && sameLine && "ring-1 ring-emerald-400/50",
                  )}
                >
                  {fmtOdds(b.odds)}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
