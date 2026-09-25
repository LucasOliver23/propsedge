# Colocar o PropsEdge no ar (≈20 min, sem instalar nada no PC)

Tudo roda na nuvem: **Supabase** (banco), **GitHub Actions** (robôs de dados, grátis em repositório público) e **Vercel** (site).

---

## 1. Supabase — pegar 3 informações (2 min)

No projeto do Supabase:

| O que | Onde |
|---|---|
| **Project URL** | Project Settings → API → `Project URL` |
| **anon key** | Project Settings → API → `anon public` |
| **Connection string** | botão **Connect** (topo) → aba *Connection string* → **Session pooler** → copie e troque `[YOUR-PASSWORD]` pela senha do banco |

> A string fica assim: `postgresql://postgres.abcd1234:SUASENHA@aws-0-sa-east-1.pooler.supabase.com:5432/postgres`
> Se a senha tiver `@ # / ? %`, troque no *Database → Settings → Reset password* por uma só com letras e números (mais fácil que codificar).
> Use o **Session pooler (porta 5432)** — a conexão "Direct" não funciona no GitHub Actions (IPv6).

Ainda no Supabase: **Database → Extensions** → ative `pg_cron`, `pg_trgm` e `unaccent`.

## 2. GitHub — subir o código e cadastrar os segredos (5 min)

1. Crie um repositório **público** chamado `propsedge` (público = minutos de Actions ilimitados; os segredos continuam protegidos).
2. Na página do repositório vazio, clique **uploading an existing file** e arraste **o conteúdo** da pasta `propsedge` (as pastas `supabase`, `workers`, `web`, `scripts`, `.github` e os arquivos soltos) → **Commit changes**.
   - Confira se a pasta `.github/workflows` apareceu. Se não, use *Add file → Create new file*, digite `.github/workflows/setup.yml` como nome e cole o conteúdo do arquivo (repita para `ingest.yml` e `ci.yml`).
3. **Settings → Secrets and variables → Actions → New repository secret**:
   - `DATABASE_URL` = a connection string do passo 1
   - `ODDS_API_KEY` = sua chave da The Odds API
4. (Opcional, controle de créditos) Na aba **Variables** do mesmo lugar:

| Variável | Padrão | Plano grátis (500/mês) |
|---|---|---|
| `ODDS_MAX_MARKETS` | 3 | 1 |
| `ODDS_MAX_EVENTS_PER_RUN` | 10 | 2 |
| `ODDS_REFRESH_MINUTES` | 180 | 720 |
| `ODDS_REGIONS` | us | us (`us,eu` inclui Pinnacle e custa 2x) |

## 3. Rodar a carga inicial (1 clique, ~10–30 min)

**Actions → setup → Run workflow**
- `days`: 30 (histórico)
- `admin_email`: deixe vazio agora (preencha no passo 5)

Ele cria o banco, carrega 30 dias de jogos e estatísticas (MLB, NFL, WNBA, NHL, futebol…), calcula o DvP, busca odds e roda o modelo. O passo **4. Diagnóstico** no final mostra quantos jogos/props/análises entraram — **se algo vier zerado, me mande esse log**.

> A NBA começa a temporada em outubro: para ter L10 desde o 1º jogo, rode depois `setup` com `days: 200` e `sports: nba`.

Depois disso o workflow **ingest** roda sozinho: agenda a cada 3h, e a cada 15 min atualiza placar ao vivo, liquida Green/Red, busca odds e recalcula confiança.

## 4. Vercel — publicar o site (3 min)

1. **Add New → Project** → importe o repositório `propsedge`.
2. **Root Directory**: `web` (Framework: Next.js, detectado sozinho).
3. **Environment Variables**:
   - `NEXT_PUBLIC_SUPABASE_URL` = Project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = anon key
4. **Deploy**. Anote a URL (ex.: `https://propsedge.vercel.app`).

Volte no Supabase → **Authentication → URL Configuration**:
- *Site URL*: sua URL da Vercel
- *Redirect URLs*: `https://SUA-URL.vercel.app/auth/callback`

## 5. Entrar e virar admin

1. Abra o site → **Bilheteira** → faça login com seu e-mail (link mágico).
2. GitHub → **Actions → setup → Run workflow** com `admin_email` = seu e-mail e `days` = 1.
   Isso libera EV+, comparador de odds e o filtro "Só EV+" para você.

Pronto: painel em `/props`, ao vivo em `/live`, bilheteira com Green/Red automático em `/bets`.

---

## Opcional — ao vivo a cada 20 s (em vez de 15 min)

O cron do GitHub atualiza jogos ao vivo a cada ~15 min. Para tempo real de verdade, suba o worker contínuo no Fly.io (~US$ 2/mês):

```bash
cd workers
fly launch --no-deploy --copy-config
fly secrets set DATABASE_URL="..." ODDS_API_KEY="..."
fly deploy
```
Com ele no ar (modo tudo-em-um), você pode desativar o workflow `ingest` e deixar o repositório privado.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| `setup` falha em "Conferir segredos" com timeout | Usou a conexão *Direct* — troque pela *Session pooler* |
| `password authentication failed` | Senha errada ou com caractere especial na URL |
| `extension "pg_cron" is not available` | Ative pg_cron em Database → Extensions e rode `setup` de novo |
| Painel vazio | Sem odds nas próximas 36h (ou créditos da Odds API zerados) — veja o log do `ingest` |
| Login não volta para o site | Faltou a Redirect URL no Supabase Auth |
| Workflows param após 60 dias | GitHub pausa crons de repositórios sem commits; qualquer commit reativa |
