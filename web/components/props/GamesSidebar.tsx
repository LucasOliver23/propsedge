"use client";

import clsx from "clsx";
import { brDateKey, kickoff } from "@/lib/format";

export interface SidebarGame {
  id: number;
  home: string;
  away: string;
  start: string;
  live?: boolean;
}

/** Sidebar esquerda "Jogos" (igual ao painel do PropsBR): lista os confrontos do
 * dia agrupados por data, com checkbox pra filtrar o board por jogo específico
 * e um indicador ao vivo nos que já começaram. */
export function GamesSidebar({
  games,
  selected,
  onToggle,
  onClear,
}: {
  games: SidebarGame[];
  selected: Set<number>;
  onToggle: (id: number) => void;
  onClear: () => void;
}) {
  const groups = new Map<string, SidebarGame[]>();
  for (const g of games) {
    const key = brDateKey(g.start);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(g);
  }

  if (!games.length) {
    return (
      <aside className="rounded-xl border border-line bg-surface p-4 text-sm text-slate-500">
        Nenhum jogo nas próximas horas.
      </aside>
    );
  }

  return (
    <aside className="flex max-h-[calc(100vh-7rem)] flex-col rounded-xl border border-line bg-surface lg:sticky lg:top-4">
      <div className="flex items-center justify-between border-b border-line px-3.5 py-3">
        <h2 className="text-xs font-bold uppercase tracking-wide text-slate-300">Jogos</h2>
        {selected.size > 0 && (
          <button onClick={onClear} className="text-[11px] text-slate-500 underline hover:text-slate-300">
            limpar
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {Array.from(groups.entries()).map(([dateKey, list]) => (
          <div key={dateKey} className="mb-2">
            <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {dayLabel(dateKey)}
            </p>
            <ul className="space-y-1">
              {list.map((g) => {
                const active = selected.has(g.id);
                return (
                  <li key={g.id}>
                    <button
                      onClick={() => onToggle(g.id)}
                      className={clsx(
                        "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs transition",
                        active ? "bg-brand-500/15 text-brand-200" : "text-slate-300 hover:bg-white/5",
                      )}
                    >
                      <span
                        className={clsx(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                          active ? "border-brand-400 bg-brand-500" : "border-line",
                        )}
                      >
                        {active && <span className="h-1.5 w-1.5 rounded-sm bg-black" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 font-semibold text-slate-100">
                          {g.home} <span className="text-slate-500">vs</span> {g.away}
                          {g.live && (
                            <span className="flex items-center gap-1 rounded bg-rose-500/15 px-1 py-0.5 text-[9px] font-bold uppercase text-rose-300">
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" />
                              Live
                            </span>
                          )}
                        </span>
                        <span className="block text-[11px] text-slate-500">{kickoff(g.start)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </aside>
  );
}

// Mesmo fuso fixo usado em lib/format.ts: evita o mesmo bug de hidratação (erro #425)
// que já corrigimos uma vez — toLocaleDateString sem timeZone diverge entre o
// render do servidor (UTC) e o do navegador do usuário.
const TZ = "America/Sao_Paulo";

function dayLabel(dateKey: string) {
  const today = brDateKey(new Date().toISOString());
  const tomorrow = brDateKey(new Date(Date.now() + 86400000).toISOString());
  if (dateKey === today) return "Hoje";
  if (dateKey === tomorrow) return "Amanhã";
  const [y, m, d] = dateKey.split("-").map(Number);
  // Meio-dia UTC do dia em questão: longe o bastante da meia-noite pra nunca
  // "vazar" pro dia anterior/seguinte ao formatar em -03:00.
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  const weekday = date.toLocaleDateString("pt-BR", { weekday: "long", timeZone: TZ });
  return `${weekday}, ${d}/${m}`;
}
