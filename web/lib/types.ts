export type SportId =
  | "soccer" | "nba" | "mlb" | "tennis" | "nfl" | "nhl" | "wnba" | "ncaab" | "cs2" | "lol";

export type Side = "over" | "under";
export type BetStatus = "pending" | "live" | "green" | "red" | "push" | "void";
export type GameStatus = "scheduled" | "live" | "final" | "postponed" | "cancelled";

export interface BookOdds {
  book: string;
  line: number;
  odds: number | null;
}

/** Linha da view `v_props_board` */
export interface PropRow {
  market_id: number;
  side: Side;
  line: number;
  sport_id: SportId;
  stat_key: string;
  stat_label: string | null;
  game_id: number;
  start_time: string;
  game_status: GameStatus;
  player_id: number;
  player_name: string;
  position: string | null;
  headshot_url: string | null;
  player_status: string;
  team_abbr: string | null;
  opp_abbr: string | null;
  is_home: boolean;
  l5_hits: number | null;  l5_n: number | null;
  l10_hits: number | null; l10_n: number | null;
  l20_hits: number | null; l20_n: number | null;
  h2h_hits: number | null; h2h_n: number | null;
  season_avg: number | null;
  l10_values: number[];
  l10_opps: string[];
  dvp_rank: number | null;
  dvp_factor: number | null;
  proj_mean: number | null;
  model_prob: number | null;
  confidence: number;
  best_book: string | null;
  best_odds: number | null;
  ev: number | null;         // null => plano free (mascarado no banco)
  fair_prob: number | null;
  books: BookOdds[] | null;  // null => plano free
  computed_at: string;
}

/** Linha da view `v_my_bets` */
export interface TrackedBet {
  id: string;
  market_id: number;
  game_id: number;
  player_id: number;
  player_name: string;
  stat_key: string;
  stat_label: string | null;
  side: Side;
  line: number;
  odds: number;
  bookmaker_id: string | null;
  stake: number;
  status: BetStatus;
  result_value: number | null;
  profit: number | null;
  live_value: number | null;
  game_status: GameStatus;
  start_time: string;
  period: string | null;
  clock: string | null;
  home_score: number | null;
  away_score: number | null;
  home_abbr: string;
  away_abbr: string;
  created_at: string;
  settled_at: string | null;
}

export interface Profile {
  id: string;
  username: string | null;
  plan: "free" | "pro" | "elite";
  bankroll: number;
  starting_bankroll: number;
  unit_size: number;
}
