# PropsEdge — SaaS de análise de Player Props

Next.js 14 + Tailwind (Vercel) · Supabase/PostgreSQL (dados, auth, Realtime, pg_cron) · Python (ingestão e modelo)

```
                    ┌────────────── GitHub Actions (cron serverless) ──────────────┐
 ESPN / Sportradar ─┤ schedule (3h) · a cada 15 min: boxscores → odds → analytics  │
 The Odds API      ─┤                                                              │
 PandaScore        ─┘                                                              ▼
                                                                    ┌───────────────────────┐
 Fly.io  live_worker (20s) ── placar + live_player_stats ─────────▶ │  Supabase Postgres    │
                                                                    │  triggers:            │
                          box score final + stats_final=true ─────▶ │  games_settle →       │
                                                                    │  settle_game()        │
                                                                    │  (Green/Red+bankroll) │
                                                                    │  pg_cron: DvP, rede   │
                                                                    │  de segurança         │
                                                                    └──────────┬────────────┘
                                                                  Realtime (WebSocket) + PostgREST
                                                                               ▼
                                                                    Next.js (Vercel): /props /live /bets
```

## Estrutura

```
propsedge/
├── supabase/migrations/
│   ├── 0001_core_schema.sql          # ETAPA 1 – tabelas, partições, índices
│   ├── 0002_functions_settlement.sql # ETAPA 4 – track_prop, settle_game, trigger, views
│   └── 0003_rls_realtime_cron.sql    # RLS, publicação Realtime, pg_cron
├── workers/                          # Python 3.12
│   ├── engine/confidence.py          # ETAPA 2 – Confidence Score 0-100
│   ├── engine/odds_math.py           #           de-vig, EV, Kelly
│   ├── providers/                    # adaptadores (ESPN, The Odds API, PandaScore, tênis)
│   ├── jobs/                         # schedule, odds, boxscores, analytics, live_worker
│   ├── tests/test_engine.py
│   ├── run.py                        # CLI única
│   └── Dockerfile / fly.toml         # live worker
├── web/                              # ETAPA 3 – Next.js
│   ├── app/{props,live,bets,login,auth/callback}
│   ├── components/props/             # PropsDashboard, PropRowItem, ConfidenceBar, L10Chart, OddsComparison, PinButton
│   ├── components/live/LiveTracker.tsx
│   ├── components/bets/BetSlip.tsx
│   ├── hooks/                        # usePropsBoard, useTrackedBets (Realtime)
│   └── lib/                          # supabase client/server, tipos, formatação
└── .github/workflows/ingest.yml      # crons de ingestão
```

## Decisões de arquitetura

| Tema | Decisão | Por quê |
|---|---|---|
| Volume de stats | `player_game_stats` particionada por ano, estatísticas em `jsonb` (1 linha por jogador/jogo) | Um único schema serve os 10 esportes; índice `(player_id, game_date desc) include (stats)` faz L5/L10/L20 em index-only scan |
| Odds | `odds_current` (snapshot pequeno, lido pelo painel) + `odds_history` particionada por mês com BRIN | Leitura rápida e histórico de movimento de linha sem inchar a tabela quente |
| Modelo | Pré-calculado em `prop_analytics` pelo worker | O front só lê uma view; nada de cálculo pesado no browser/edge |
| Premium | `is_premium()` mascara EV e comparador **dentro da view** | Não dá para burlar pelo front |
| Bankroll | Só muda via funções `security definer`; `update` em `bankroll` revogado | Usuário não consegue editar saldo pela API |
| Liquidação | Trigger no Postgres (set-based, idempotente) + `pg_cron` de rede de segurança a cada 5 min | Green/Red não depende do worker estar vivo no momento certo |
| Live | Processo contínuo (Fly.io) + Supabase Realtime | Serverless tem timeout/cold start; o browser não faz polling |

## Deploy

Passo a passo completo (Supabase → GitHub → Vercel, sem instalar nada no PC): **[DEPLOY.md](DEPLOY.md)**.

Rodar local: `cd workers && pip install -r requirements.txt && cp .env.example .env && python run.py setup --days 30 --sports mlb`
Front local: `cd web && npm i && npm run dev`

## Confidence Score (resumo)

| Componente | Peso |
|---|---|
| L10 hit rate | 30% |
| DvP | 20% |
| H2H | 15% |
| Projeção (Poisson/Normal com ajuste DvP) | 15% |
| L5 | 10% |
| L20 | 10% |

Hit rates com encolhimento Bayesiano em direção à prob. do mercado (evita "3/3 = 100%"), confiabilidade por amostra e concordância entre componentes, e EV contra o preço justo (Pinnacle sem vig ou mediana das casas, 65%) combinado com o modelo (35%). Detalhes e fórmulas no topo de `workers/engine/confidence.py`.

## O que precisa de atenção antes de produção

- **Provedores de dados**: ESPN (JSON público, não oficial) serve para MVP em NBA/WNBA/NCAAB/NFL/MLB/NHL/Futebol. Para SLA, troque por Sportradar/SportsDataIO implementando `StatsProvider`. Valide as chaves (`keys`) de cada esporte com um jogo real.
- **Tênis, CS2 e LoL**: contrato pronto, mas box score e odds de props exigem planos pagos (Sportradar Tennis, PandaScore stats, OpticOdds/OddsJam). A agenda de esports via PandaScore já está implementada.
- **Custo da The Odds API**: cada evento consome (mercados × regiões) créditos por chamada. Ajuste `ODDS_REGIONS`, horário e frequência do cron ao seu plano.
- **Calibração**: após algumas semanas de apostas liquidadas, compare `confidence_at_pick` com a taxa real de green por faixa e ajuste `WEIGHTS`/`MARKET_BLEND`.
- **Partições**: crie as partições futuras de `odds_history` (mensal) e `player_game_stats` (anual) — ou use `pg_partman`.
- **Jogo responsável / legal**: o bankroll é virtual; se houver links de afiliado, respeite a regulamentação local (no Brasil, Lei 14.790/2023 e portarias da SPA/MF).
