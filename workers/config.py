"""Configuração central dos workers (lida de variáveis de ambiente)."""
from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.environ["DATABASE_URL"]  # Supabase: Session pooler (porta 5432)
ODDS_API_KEY = os.getenv("ODDS_API_KEY", "")
PANDASCORE_TOKEN = os.getenv("PANDASCORE_TOKEN", "")
# The Odds API: custo por chamada = nº de mercados x nº de regiões. Padrões econômicos:
ODDS_REGIONS = os.getenv("ODDS_REGIONS", "us")            # "us,eu" inclui Pinnacle (sharp), custa 2x
BOOKMAKERS = os.getenv("BOOKMAKERS", "")                   # vazio = todas as casas das regiões
ODDS_MAX_EVENTS_PER_RUN = int(os.getenv("ODDS_MAX_EVENTS_PER_RUN", "10"))
ODDS_MAX_MARKETS = int(os.getenv("ODDS_MAX_MARKETS", "3"))          # mercados por esporte (por prioridade)
ODDS_REFRESH_MINUTES = int(os.getenv("ODDS_REFRESH_MINUTES", "180"))  # não rebusca o mesmo jogo antes disso
ODDS_MIN_REMAINING = int(os.getenv("ODDS_MIN_REMAINING", "25"))      # para de buscar abaixo desse saldo
LIVE_POLL_SECONDS = int(os.getenv("LIVE_POLL_SECONDS", "20"))


@dataclass(frozen=True)
class SportCfg:
    id: str
    stats_provider: str             # 'espn' | 'tennis' | 'pandascore'
    espn_paths: tuple[str, ...] = ()  # ex.: ('basketball/nba',) — futebol tem várias ligas
    odds_api_keys: tuple[str, ...] = ()


SPORTS: dict[str, SportCfg] = {
    "nba":    SportCfg("nba", "espn", ("basketball/nba",), ("basketball_nba",)),
    "wnba":   SportCfg("wnba", "espn", ("basketball/wnba",), ("basketball_wnba",)),
    "ncaab":  SportCfg("ncaab", "espn", ("basketball/mens-college-basketball",), ("basketball_ncaab",)),
    "nfl":    SportCfg("nfl", "espn", ("football/nfl",), ("americanfootball_nfl",)),
    "mlb":    SportCfg("mlb", "espn", ("baseball/mlb",), ("baseball_mlb",)),
    "nhl":    SportCfg("nhl", "espn", ("hockey/nhl",), ("icehockey_nhl",)),
    "soccer": SportCfg("soccer", "espn",
                       ("soccer/bra.1", "soccer/eng.1", "soccer/esp.1", "soccer/uefa.champions"),
                       ("soccer_epl", "soccer_spain_la_liga", "soccer_brazil_campeonato", "soccer_uefa_champs_league")),
    "tennis": SportCfg("tennis", "tennis"),
    "cs2":    SportCfg("cs2", "pandascore"),
    "lol":    SportCfg("lol", "pandascore"),
}

# Combos gerados na ingestão (ficam dentro de player_game_stats.stats)
COMBOS: dict[str, dict[str, tuple[str, ...]]] = {
    "nba":   {"pra": ("points", "rebounds", "assists"), "pr": ("points", "rebounds"),
              "pa": ("points", "assists"), "ra": ("rebounds", "assists")},
    "wnba":  {"pra": ("points", "rebounds", "assists")},
    "ncaab": {"pra": ("points", "rebounds", "assists")},
}
