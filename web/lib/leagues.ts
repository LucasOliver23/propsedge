export const LEAGUES: Record<string, string> = {
  "soccer/bra.1": "Brasileirão A",
  "soccer/bra.2": "Brasileirão B",
  "soccer/bra.copa_do_brazil": "Copa do Brasil",
  "soccer/conmebol.libertadores": "Libertadores",
  "soccer/conmebol.sudamericana": "Sul-Americana",
  "soccer/eng.1": "Premier League",
  "soccer/esp.1": "La Liga",
  "soccer/ita.1": "Serie A (ITA)",
  "soccer/ger.1": "Bundesliga",
  "soccer/fra.1": "Ligue 1",
  "soccer/uefa.champions": "Champions League",
  "soccer/uefa.europa": "Europa League",
  "basketball/nba": "NBA",
  "basketball/wnba": "WNBA",
  "basketball/mens-college-basketball": "NCAAB",
  "football/nfl": "NFL",
  "baseball/mlb": "MLB",
  "hockey/nhl": "NHL",
};

export const leagueName = (slug: string | null): string => (slug ? LEAGUES[slug] ?? slug.split("/").pop() ?? slug : "");
