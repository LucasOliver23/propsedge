"""Acesso ao Postgres (psycopg 3). Upserts em lote e helpers de resolução de IDs."""
from __future__ import annotations

import json
from contextlib import contextmanager
from typing import Any, Iterator, Sequence

import psycopg
from psycopg.rows import dict_row

from config import DATABASE_URL


@contextmanager
def connect() -> Iterator[psycopg.Connection]:
    # prepare_threshold=None: compatível com o pooler do Supabase (modo transaction)
    with psycopg.connect(DATABASE_URL, row_factory=dict_row, prepare_threshold=None, autocommit=False) as conn:
        yield conn


def upsert(conn: psycopg.Connection, table: str, rows: Sequence[dict[str, Any]],
           conflict: Sequence[str], update: Sequence[str] | None = None,
           returning: str | None = None) -> list[dict]:
    """INSERT ... ON CONFLICT em lote. `update=None` => atualiza todas as colunas não-chave."""
    if not rows:
        return []
    cols = list(rows[0].keys())
    update = [c for c in cols if c not in conflict] if update is None else update
    set_sql = ", ".join(f"{c} = excluded.{c}" for c in update) or f"{conflict[0]} = excluded.{conflict[0]}"
    sql = (
        f"insert into {table} ({', '.join(cols)}) values ({', '.join(['%s'] * len(cols))}) "
        f"on conflict ({', '.join(conflict)}) do update set {set_sql}"
        + (f" returning {returning}" if returning else "")
    )
    params = [[json.dumps(r[c]) if isinstance(r[c], (dict, list)) else r[c] for c in cols] for r in rows]
    out: list[dict] = []
    with conn.cursor() as cur:
        if returning:
            for p in params:
                cur.execute(sql, p)
                out.extend(cur.fetchall())
        else:
            cur.executemany(sql, params)
    return out


def get_or_create_team(conn, sport_id: str, name: str, abbr: str | None, ext_key: str, ext_id: str,
                       logo: str | None = None) -> int:
    with conn.cursor() as cur:
        cur.execute("select id, logo_url from teams where sport_id=%s and external_ids->>%s = %s", (sport_id, ext_key, ext_id))
        row = cur.fetchone()
        if row:
            if logo and not row["logo_url"]:
                cur.execute("update teams set logo_url=%s where id=%s", (logo, row["id"]))
            return row["id"]
        cur.execute(
            """insert into teams (sport_id, name, abbr, logo_url, external_ids)
               values (%s,%s,%s,%s,jsonb_build_object(%s::text,%s::text))
               on conflict (sport_id, name) do update
                 set external_ids = teams.external_ids || excluded.external_ids, abbr = coalesce(excluded.abbr, teams.abbr),
                     logo_url = coalesce(teams.logo_url, excluded.logo_url)
               returning id""",
            (sport_id, name, abbr, logo, ext_key, ext_id),
        )
        return cur.fetchone()["id"]


_player_cache: dict[tuple[str, str, str, int], int] = {}


def get_or_create_player(conn, sport_id: str, team_id: int, name: str, position: str | None,
                         ext_key: str, ext_id: str, headshot: str | None = None) -> int:
    ck = (sport_id, ext_key, ext_id, team_id)
    if ck in _player_cache:          # evita 2 queries por jogador em cargas grandes
        return _player_cache[ck]
    pid = _get_or_create_player(conn, sport_id, team_id, name, position, ext_key, ext_id, headshot)
    _player_cache[ck] = pid
    return pid


def _get_or_create_player(conn, sport_id, team_id, name, position, ext_key, ext_id, headshot) -> int:
    with conn.cursor() as cur:
        cur.execute("select id from players where sport_id=%s and external_ids->>%s = %s", (sport_id, ext_key, ext_id))
        row = cur.fetchone()
        if row:
            # mantém time/posição atualizados (trocas de elenco)
            cur.execute("""update players set team_id=%s, position=coalesce(%s, position),
                                  headshot_url=coalesce(%s, headshot_url) where id=%s""",
                        (team_id, position, headshot, row["id"]))
            return row["id"]
        if ext_key not in ("espn", "pandascore", "tennis"):
            raise ValueError(f"ext_key inválido: {ext_key}")
        cur.execute(
            f"""insert into players (sport_id, team_id, name, position, headshot_url, external_ids)
               values (%s,%s,%s,%s,%s,jsonb_build_object(%s::text,%s::text))
               on conflict (sport_id, (external_ids->>'{ext_key}')) where external_ids ? '{ext_key}'
               do update set team_id = excluded.team_id
               returning id""",
            (sport_id, team_id, name, position, headshot, ext_key, ext_id),
        )
        pid = cur.fetchone()["id"]
    # commit imediato: libera o lock do índice único para as outras threads (sem deadlock)
    conn.commit()
    return pid
