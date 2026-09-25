#!/usr/bin/env bash
# Aplica as migrations de supabase/migrations em ordem, uma única vez cada (controle em ops._migrations).
set -euo pipefail
: "${DATABASE_URL:?defina DATABASE_URL}"
PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X -q)

"${PSQL[@]}" -c "create schema if not exists ops; create table if not exists ops._migrations (name text primary key, applied_at timestamptz default now());"
for f in supabase/migrations/*.sql; do
  n=$(basename "$f")
  if [ "$("${PSQL[@]}" -tAc "select 1 from ops._migrations where name = '$n'")" = "1" ]; then
    echo "✔ já aplicada: $n"
  else
    echo "→ aplicando: $n"
    "${PSQL[@]}" -1 -f "$f"
    "${PSQL[@]}" -c "insert into ops._migrations (name) values ('$n')"
    echo "✔ aplicada: $n"
  fi
done
