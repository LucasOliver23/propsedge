export const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const pct = (n: number | null | undefined, digits = 0) =>
  n == null ? "—" : `${(n * 100).toFixed(digits)}%`;

export const signedPct = (n: number | null | undefined, digits = 1) =>
  n == null ? "—" : `${n > 0 ? "+" : ""}${(n * 100).toFixed(digits)}%`;

export const odds = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(2));

export function kickoff(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `Hoje ${time}` : `${d.toLocaleDateString("pt-BR", { weekday: "short" })} ${time}`;
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
