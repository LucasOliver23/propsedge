export const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const pct = (n: number | null | undefined, digits = 0) =>
  n == null ? "—" : `${(n * 100).toFixed(digits)}%`;

export const signedPct = (n: number | null | undefined, digits = 1) =>
  n == null ? "—" : `${n > 0 ? "+" : ""}${(n * 100).toFixed(digits)}%`;

export const odds = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(2));

// Fuso fixo (Brasil não tem mais horário de verão): formata igual no servidor (SSR, UTC)
// e no navegador do usuário, senão o texto diverge entre os dois e o React quebra a
// hidratação (erro #425) — foi exatamente isso que aconteceu antes dessa correção.
const TZ = "America/Sao_Paulo";

/** Data (YYYY-MM-DD) no fuso de Brasília, sem depender do fuso da máquina que roda o código. */
export function brDateKey(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ }); // en-CA = formato ISO yyyy-mm-dd
}

export function kickoff(iso: string) {
  const d = new Date(iso);
  const sameDay = brDateKey(iso) === brDateKey(new Date().toISOString());
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
  return sameDay ? `Hoje ${time}` : `${d.toLocaleDateString("pt-BR", { weekday: "short", timeZone: TZ })} ${time}`;
}

/** Cor da confiança: vermelho < 45 < âmbar < 60 < verde */
export function confidenceTone(c: number) {
  if (c >= 70) return { bar: "bg-emerald-400", text: "text-emerald-300" };
  if (c >= 60) return { bar: "bg-green-500", text: "text-green-400" };
  if (c >= 45) return { bar: "bg-amber-400", text: "text-amber-300" };
  return { bar: "bg-rose-500", text: "text-rose-400" };
}

export function hitRate(hits: number | null, n: number | null) {
  if (hits == null || !n) return null;
  return hits / n;
}

/** Texto da aposta: "Mais 2.5 Gols" ou, em mercado sim/não, "Ambas marcam: Sim" */
export function betText(statKey: string, side: "over" | "under", line: number, label: string | null, long = false) {
  if (statKey === "btts") return `Ambas marcam: ${side === "over" ? "Sim" : "Não"}`;
  const s = side === "over" ? (long ? "Mais de" : "Mais") : long ? "Menos de" : "Menos";
  return `${s} ${line} ${label ?? statKey}`;
}
