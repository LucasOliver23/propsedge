import type { SportId } from "./types";

export const SPORTS: { id: SportId; label: string; emoji: string }[] = [
  { id: "soccer", label: "Futebol", emoji: "⚽" },
  { id: "nba", label: "NBA", emoji: "🏀" },
  { id: "mlb", label: "MLB", emoji: "⚾" },
  { id: "tennis", label: "Tênis", emoji: "🎾" },
  { id: "nfl", label: "NFL", emoji: "🏈" },
  { id: "nhl", label: "NHL", emoji: "🏒" },
  { id: "wnba", label: "WNBA", emoji: "🏀" },
  { id: "ncaab", label: "NCAAB", emoji: "🎓" },
  { id: "cs2", label: "CS2", emoji: "🎯" },
  { id: "lol", label: "LoL", emoji: "🧙" },
];

export const BOOK_LABELS: Record<string, string> = {
  pinnacle: "Pinnacle",
  bet365: "Bet365",
  betano: "Betano",
  draftkings: "DraftKings",
  fanduel: "FanDuel",
  superbet: "Superbet",
};

export const RPC_ERRORS: Record<string, string> = {
  not_authenticated: "Entre na sua conta para fixar props.",
  game_already_started: "O jogo já começou — não dá mais para fixar.",
  insufficient_bankroll: "Saldo virtual insuficiente para essa stake.",
  no_odds_available: "Sem odds disponíveis para esse lado agora.",
  market_not_found: "Mercado não encontrado (pode ter sido removido).",
  cannot_untrack: "Só é possível desafixar antes do início do jogo.",
};

export function rpcErrorMessage(message?: string): string {
  if (!message) return "Erro inesperado.";
  const key = Object.keys(RPC_ERRORS).find((k) => message.includes(k));
  return key ? RPC_ERRORS[key] : message;
}
