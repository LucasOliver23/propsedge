-- =====================================================================
-- PropsEdge — Schema principal (PostgreSQL 15+ / Supabase)
-- Estratégia de volume:
--   * player_game_stats  -> particionada por ano (game_date), stats em JSONB
--   * odds_history       -> particionada por mês (captured_at), append-only, índice BRIN
--   * odds_current / prop_analytics -> tabelas "quentes" pequenas (só o snapshot atual)
-- =====================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- ---------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------
create type game_status as enum ('scheduled', 'live', 'final', 'postponed', 'cancelled');
create type bet_side    as enum ('over', 'under');           -- "yes/no" (ex.: marcar gol) = over/under 0.5
create type bet_status  as enum ('pending', 'live', 'green', 'red', 'push', 'void');
create type plan_tier   as enum ('free', 'pro', 'elite');

-- ---------------------------------------------------------------------
-- CATÁLOGO
-- ---------------------------------------------------------------------
create table sports (
  id            text primary key,              -- slug interno
  name          text not null,
  is_individual boolean not null default false, -- tênis: cada tenista é também um "team" (participante)
  is_esport     boolean not null default false,
  sort_order    smallint not null default 0
);

insert into sports (id, name, is_individual, is_esport, sort_order) values
  ('soccer', 'Futebol', false, false, 1),
  ('nba',    'NBA',     false, false, 2),
  ('mlb',    'MLB',     false, false, 3),
  ('tennis', 'Tênis',   true,  false, 4),
  ('nfl',    'NFL',     false, false, 5),
  ('nhl',    'NHL',     false, false, 6),
  ('wnba',   'WNBA',    false, false, 7),
  ('ncaab',  'NCAAB',   false, false, 8),
  ('cs2',    'CS2',     false, true,  9),
  ('lol',    'League of Legends', false, true, 10);

create table leagues (
  id           bigint generated always as identity primary key,
  sport_id     text not null references sports(id),
  name         text not null,
  country      text,
  external_ids jsonb not null default '{}',
  unique (sport_id, name)
);

create table teams (
  id           bigint generated always as identity primary key,
  sport_id     text not null references sports(id),
  league_id    bigint references leagues(id),
  name         text not null,
  abbr         text,
  logo_url     text,
  external_ids jsonb not null default '{}',     -- {"espn":"13","odds_api":"Los Angeles Lakers","pandascore":"..."}
  unique (sport_id, name)
);
create index teams_ext_idx on teams using gin (external_ids jsonb_path_ops);

create table players (
  id           bigint generated always as identity primary key,
  sport_id     text not null references sports(id),
  team_id      bigint references teams(id),
  name         text not null,
  name_norm    text,                            -- lower(unaccent(name)), preenchido por trigger
  position     text,                            -- 'PG','C','FW','SP','ADC','AWP'...
  status       text not null default 'active',  -- active | questionable | out
  headshot_url text,
  external_ids jsonb not null default '{}'
);
create index players_team_idx on players (team_id);
create index players_ext_idx  on players using gin (external_ids jsonb_path_ops);
create index players_trgm_idx on players using gin (name_norm gin_trgm_ops);
-- 1 jogador por ID de provedor (evita duplicatas em cargas paralelas)
create unique index players_espn_uniq on players (sport_id, (external_ids->>'espn')) where external_ids ? 'espn';
create unique index players_pandascore_uniq on players (sport_id, (external_ids->>'pandascore')) where external_ids ? 'pandascore';
create unique index players_tennis_uniq on players (sport_id, (external_ids->>'tennis')) where external_ids ? 'tennis';

-- unaccent não é IMMUTABLE (não pode ir em coluna gerada) -> trigger
create or replace function players_set_name_norm() returns trigger language plpgsql as $$
begin new.name_norm := lower(unaccent(new.name)); return new; end $$;
create trigger players_name_norm before insert or update of name on players
  for each row execute function players_set_name_norm();

-- Mercados suportados por esporte (o front usa label; os workers usam key)
create table stat_types (
  sport_id text not null references sports(id),
  key      text not null,          -- 'points','pra','shots_on_target','aces','kills'...
  label    text not null,
  odds_api_market text,            -- chave do mercado na The Odds API (ex.: 'player_points')
  priority smallint not null default 5,  -- 1 = buscado primeiro (controle de créditos da Odds API)
  primary key (sport_id, key)
);

insert into stat_types (sport_id, key, label, odds_api_market) values
  ('nba','points','Pontos','player_points'),
  ('nba','rebounds','Rebotes','player_rebounds'),
  ('nba','assists','Assistências','player_assists'),
  ('nba','threes','Cestas de 3','player_threes'),
  ('nba','pra','Pts+Reb+Ast','player_points_rebounds_assists'),
  ('wnba','points','Pontos','player_points'),
  ('wnba','rebounds','Rebotes','player_rebounds'),
  ('wnba','assists','Assistências','player_assists'),
  ('ncaab','points','Pontos','player_points'),
  ('ncaab','rebounds','Rebotes','player_rebounds'),
  ('mlb','hits','Rebatidas','batter_hits'),
  ('mlb','total_bases','Total de bases',null),   -- ESPN não traz 2B/3B no box score
  ('mlb','strikeouts','Strikeouts (arremessador)','pitcher_strikeouts'),
  ('nfl','pass_yds','Jardas passe','player_pass_yds'),
  ('nfl','rush_yds','Jardas corrida','player_rush_yds'),
  ('nfl','rec_yds','Jardas recepção','player_reception_yds'),
  ('nfl','receptions','Recepções','player_receptions'),
  ('nhl','shots','Chutes a gol','player_shots_on_goal'),
  ('nhl','points','Pontos','player_points'),
  ('soccer','shots_on_target','Chutes no gol','player_shots_on_target'),
  ('soccer','shots','Finalizações','player_shots'),
  ('soccer','goals','Marcar gol','player_goal_scorer_anytime'),
  ('tennis','aces','Aces',null),
  ('tennis','games_won','Games vencidos',null),
  ('cs2','kills','Kills (mapas 1-2)',null),
  ('cs2','headshots','Headshots (mapas 1-2)',null),
  ('lol','kills','Kills (série)',null),
  ('lol','assists','Assistências (série)',null);

update stat_types set priority = 1 where (sport_id, key) in
  (('nba','points'),('wnba','points'),('ncaab','points'),('mlb','strikeouts'),('mlb','hits'),
   ('nfl','pass_yds'),('nfl','rec_yds'),('nhl','shots'),('soccer','shots_on_target'));
update stat_types set priority = 2 where (sport_id, key) in
  (('nba','rebounds'),('nba','assists'),('wnba','rebounds'),('nfl','rush_yds'),('soccer','shots'),('nhl','points'));

create table bookmakers (
  id            text primary key,     -- mesmo slug da The Odds API
  name          text not null,
  is_sharp      boolean not null default false,  -- usado como referência de "preço justo"
  affiliate_url text,
  active        boolean not null default true
);

insert into bookmakers (id, name, is_sharp) values
  ('pinnacle','Pinnacle',true),
  ('bet365','Bet365',false),
  ('betano','Betano',false),
  ('draftkings','DraftKings',false),
  ('fanduel','FanDuel',false),
  ('superbet','Superbet',false),
  ('betmgm','BetMGM',false),
  ('williamhill_us','Caesars',false),
  ('betrivers','BetRivers',false),
  ('bovada','Bovada',false),
  ('betonlineag','BetOnline',false);
-- casas novas vindas da Odds API são cadastradas automaticamente pelo worker

-- ---------------------------------------------------------------------
-- JOGOS
-- ---------------------------------------------------------------------
create table games (
  id            bigint generated always as identity primary key,
  sport_id      text not null references sports(id),
  league_id     bigint references leagues(id),
  home_team_id  bigint not null references teams(id),
  away_team_id  bigint not null references teams(id),
  start_time    timestamptz not null,
  status        game_status not null default 'scheduled',
  period        text,               -- 'Q3', '2T', 'Mapa 2', 'Set 3'
  clock         text,
  home_score    int,
  away_score    int,
  stats_final   boolean not null default false,  -- box score completo e conferido -> libera liquidação
  odds_fetched_at timestamptz,                   -- última busca de odds (controle de créditos)
  external_ids  jsonb not null default '{}',     -- {"espn":"401656","odds_api":"e912..."}
  updated_at    timestamptz not null default now()
);
create index games_sport_time_idx on games (sport_id, start_time);
create index games_open_idx       on games (start_time) where status in ('scheduled','live');
create index games_ext_idx        on games using gin (external_ids jsonb_path_ops);

-- ---------------------------------------------------------------------
-- ESTATÍSTICAS (alto volume)
-- Uma linha por jogador/jogo. stats = {"points":27,"rebounds":8,"assists":6,"pra":41,...}
-- Os combos (pra, pr, pa...) são calculados pelo worker na ingestão.
-- ---------------------------------------------------------------------
create table player_game_stats (
  player_id        bigint not null references players(id),
  game_id          bigint not null references games(id),
  game_date        date   not null,
  sport_id         text   not null,
  team_id          bigint not null,
  opponent_team_id bigint not null,
  is_home          boolean not null,
  position         text,
  minutes          numeric(6,2),         -- 0 ou null + dnp=true => não jogou
  dnp              boolean not null default false,
  stats            jsonb not null default '{}',
  updated_at       timestamptz not null default now(),
  primary key (player_id, game_id, game_date)
) partition by range (game_date);

create table player_game_stats_2024 partition of player_game_stats for values from ('2024-01-01') to ('2025-01-01');
create table player_game_stats_2025 partition of player_game_stats for values from ('2025-01-01') to ('2026-01-01');
create table player_game_stats_2026 partition of player_game_stats for values from ('2026-01-01') to ('2027-01-01');
create table player_game_stats_2027 partition of player_game_stats for values from ('2027-01-01') to ('2028-01-01');
create table player_game_stats_default partition of player_game_stats default;

-- L5/L10/L20: "últimos N jogos do jogador" -> index-only scan
create index pgs_player_recent_idx on player_game_stats (player_id, game_date desc) include (stats, minutes, opponent_team_id, dnp);
-- H2H e DvP
create index pgs_opponent_idx on player_game_stats (opponent_team_id, position, game_date desc);
create index pgs_game_idx     on player_game_stats (game_id);

-- Estatística ao vivo (1 linha por jogador/jogo, sobrescrita) -> Supabase Realtime
create table live_player_stats (
  player_id  bigint not null references players(id),
  game_id    bigint not null references games(id) on delete cascade,
  stats      jsonb  not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (game_id, player_id)
);

-- DvP: eficiência defensiva por time x posição x estatística
create table team_defense_vs_position (
  sport_id    text   not null,
  team_id     bigint not null references teams(id),
  position    text   not null,
  stat_key    text   not null,
  games       int    not null,
  allowed_avg numeric(8,3) not null,
  league_avg  numeric(8,3) not null,
  factor      numeric(6,4) not null,   -- allowed_avg / league_avg  (>1 = defesa fraca = bom p/ over)
  rank        int    not null,         -- 1 = melhor defesa
  updated_at  timestamptz not null default now(),
  primary key (team_id, position, stat_key)
);

-- ---------------------------------------------------------------------
-- PROPS & ODDS
-- ---------------------------------------------------------------------
create table prop_markets (
  id         bigint generated always as identity primary key,
  game_id    bigint not null references games(id) on delete cascade,
  player_id  bigint not null references players(id),
  sport_id   text   not null,
  stat_key   text   not null,
  created_at timestamptz not null default now(),
  unique (game_id, player_id, stat_key)
);
create index prop_markets_player_idx on prop_markets (player_id);

-- Snapshot atual: 1 linha por mercado x casa (linha principal)
create table odds_current (
  market_id    bigint not null references prop_markets(id) on delete cascade,
  bookmaker_id text   not null references bookmakers(id),
  line         numeric(7,2) not null,
  over_odds    numeric(8,3),
  under_odds   numeric(8,3),
  updated_at   timestamptz not null default now(),
  primary key (market_id, bookmaker_id)
);

-- Histórico (movimento de linha), append-only
create table odds_history (
  market_id    bigint not null,
  bookmaker_id text   not null,
  line         numeric(7,2) not null,
  over_odds    numeric(8,3),
  under_odds   numeric(8,3),
  captured_at  timestamptz not null default now()
) partition by range (captured_at);
create table odds_history_2026_09 partition of odds_history for values from ('2026-09-01') to ('2026-10-01');
create table odds_history_2026_10 partition of odds_history for values from ('2026-10-01') to ('2026-11-01');
create table odds_history_2026_11 partition of odds_history for values from ('2026-11-01') to ('2026-12-01');
create table odds_history_2026_12 partition of odds_history for values from ('2026-12-01') to ('2027-01-01');
create table odds_history_default partition of odds_history default;
create index odds_history_brin on odds_history using brin (captured_at);
create index odds_history_market_idx on odds_history (market_id, captured_at desc);

-- Resultado do motor de análise (1 linha por mercado x lado)
create table prop_analytics (
  market_id    bigint   not null references prop_markets(id) on delete cascade,
  side         bet_side not null,
  line         numeric(7,2) not null,         -- linha de consenso usada no cálculo
  l5_hits  smallint, l5_n  smallint,
  l10_hits smallint, l10_n smallint,
  l20_hits smallint, l20_n smallint,
  h2h_hits smallint, h2h_n smallint,
  season_avg   numeric(8,2),
  l10_values   numeric[] not null default '{}',  -- já pronto p/ o gráfico (mais antigo -> mais recente)
  l10_opps     text[]    not null default '{}',
  dvp_rank     int,
  dvp_factor   numeric(6,4),
  proj_mean    numeric(8,2),
  model_prob   numeric(5,4),    -- prob. do modelo
  market_prob  numeric(5,4),    -- prob. sem vig (consenso / casa sharp)
  fair_prob    numeric(5,4),    -- blend final usado no EV
  confidence   smallint not null check (confidence between 0 and 100),
  best_book    text,
  best_odds    numeric(8,3),
  ev           numeric(7,4),    -- 0.052 = +5,2%
  computed_at  timestamptz not null default now(),
  primary key (market_id, side)
);
create index prop_analytics_conf_idx on prop_analytics (confidence desc);
create index prop_analytics_ev_idx    on prop_analytics (ev desc) where ev > 0;

create table ev_alerts (
  id           bigint generated always as identity primary key,
  market_id    bigint not null references prop_markets(id) on delete cascade,
  side         bet_side not null,
  bookmaker_id text not null,
  line         numeric(7,2) not null,
  odds         numeric(8,3) not null,
  fair_odds    numeric(8,3) not null,
  ev           numeric(7,4) not null,
  confidence   smallint not null,
  created_at   timestamptz not null default now(),
  unique (market_id, side, bookmaker_id, line, odds)
);
create index ev_alerts_recent_idx on ev_alerts (created_at desc);

-- ---------------------------------------------------------------------
-- USUÁRIOS, BILHETEIRA E BANKROLL
-- ---------------------------------------------------------------------
create table profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  username          text unique,
  plan              plan_tier not null default 'free',
  bankroll          numeric(12,2) not null default 1000 check (bankroll >= 0),
  starting_bankroll numeric(12,2) not null default 1000,
  unit_size         numeric(10,2) not null default 10,
  created_at        timestamptz not null default now()
);

create table tracked_bets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles(id) on delete cascade,
  market_id    bigint not null references prop_markets(id),
  game_id      bigint not null references games(id),
  player_id    bigint not null references players(id),
  stat_key     text not null,
  side         bet_side not null,
  line         numeric(7,2) not null,
  odds         numeric(8,3) not null check (odds > 1),
  bookmaker_id text,
  stake        numeric(10,2) not null check (stake > 0),
  status       bet_status not null default 'pending',
  result_value numeric(8,2),
  profit       numeric(12,2),
  confidence_at_pick smallint,
  ev_at_pick   numeric(7,4),
  created_at   timestamptz not null default now(),
  settled_at   timestamptz
);
create index tracked_bets_user_idx on tracked_bets (user_id, created_at desc);
create index tracked_bets_open_idx on tracked_bets (game_id) where status in ('pending','live');

create table bankroll_ledger (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references profiles(id) on delete cascade,
  bet_id        uuid references tracked_bets(id),
  amount        numeric(12,2) not null,           -- negativo = saída
  reason        text not null,                    -- stake | payout | refund | adjust
  balance_after numeric(12,2) not null,
  created_at    timestamptz not null default now()
);
create index bankroll_ledger_user_idx on bankroll_ledger (user_id, created_at desc);

-- Cria o profile automaticamente quando o usuário se cadastra
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, username) values (new.id, split_part(new.email, '@', 1))
  on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute function handle_new_user();
