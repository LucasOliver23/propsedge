"""Contexto pré-jogo vindo do ESPN (gratuito, sem créditos):

  * classificação de cada liga            -> standings
  * desfalques (lesão/suspensão)          -> player_injuries  (+ players.status = out/questionable)
  * arremessador provável (MLB)           -> game_lineups role=probable_pitcher
  * escalação confirmada (futebol, ~1h)   -> game_lineups role=starter

Roda junto com a agenda (a cada 3h) e antes das props do modelo.
Se uma fonte falhar, registra e segue com as outras.
"""
from __future__ import annotations

from datetime import date

from db import connect
from jobs.common import log, provider_for
from providers.espn import injury_level

CONTEXT_HOURS = 36

GAMES_SQL = """
select id, sport_id, external_ids, home_team_id, away_team_id
from games
where sport_id = %s and status = 'scheduled'
  and start_time between now() - interval '15 minutes' and now() + make_interval(hours => %s)
order by start_time
"""


def _team_ids(cur, sport_id: str) -> dict[str, int]:
    cur.execute("select id, external_ids->>'espn' as ext from teams where sport_id=%s and external_ids ? 'espn'",
                (sport_id,))
    return {r["ext"]: r["id"] for r in cur.fetchall()}


def _player_ids(cur, sport_id: str, exts: list[str]) -> dict[str, int]:
    if not exts:
        return {}
    cur.execute("""select id, external_ids->>'espn' as ext from players
                   where sport_id=%s and external_ids->>'espn' = any(%s::text[])""", (sport_id, exts))
    return {r["ext"]: r["id"] for r in cur.fetchall()}


def _standings(conn, prov, sport_id: str) -> int:
    rows = prov.standings(sport_id)
    if not rows:
        return 0
    with conn.cursor() as cur:
        teams = _team_ids(cur, sport_id)
        data = []
        for r in rows:
            tid = teams.get(r["team_ext"])
            if tid is None:
                continue
            data.append((r["league"], tid, r["group"], r["rank"], r["played"], r["wins"], r["draws"],
                         r["losses"], r["gf"], r["ga"], r["points"]))
        cur.executemany(
            """insert into standings (league, team_id, group_name, rank, played, wins, draws, losses,
                                      goals_for, goals_against, points, updated_at)
               values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, now())
               on conflict (league, team_id) do update set
                 group_name=excluded.group_name, rank=excluded.rank, played=excluded.played, wins=excluded.wins,
                 draws=excluded.draws, losses=excluded.losses, goals_for=excluded.goals_for,
                 goals_against=excluded.goals_against, points=excluded.points, updated_at=now()""",
            data,
        )
    return len(data)


def _context(conn, prov, sport_id: str) -> tuple[int, int, int]:
    with conn.cursor() as cur:
        cur.execute(GAMES_SQL, (sport_id, CONTEXT_HOURS))
        games = cur.fetchall()
        if not games:
            return 0, 0, 0
        teams = _team_ids(cur, sport_id)

    injuries: dict[str, dict] = {}
    lineups: list[tuple[int, dict]] = []
    ok = 0
    for g in games:
        ext = g["external_ids"].get(prov.ext_key)
        if not ext:
            continue
        try:
            ctx = prov.game_context(sport_id, ext, g["external_ids"])
            ok += 1
        except Exception as e:
            log.warning("[%s] contexto do jogo %s falhou: %s", sport_id, g["id"], e)
            continue
        for inj in ctx["injuries"]:
            injuries[inj["athlete_ext"]] = inj
        for lu in ctx["lineups"]:
            lineups.append((g["id"], lu))
    if not ok:
        return 0, 0, 0

    with conn.cursor() as cur:
        pids = _player_ids(cur, sport_id, list(injuries) + [lu["athlete_ext"] for _, lu in lineups])
        inj_rows = []
        for a, inj in injuries.items():
            ret = inj.get("return_date")
            try:
                ret = date.fromisoformat(ret[:10]) if ret else None
            except ValueError:
                ret = None
            inj_rows.append((sport_id, a, pids.get(a), teams.get(inj["team_ext"]), inj["name"], inj["position"],
                             inj["status"], inj["detail"], ret))
        cur.executemany(
            """insert into player_injuries (sport_id, athlete_ext, player_id, team_id, name, position, status,
                                            detail, return_date, updated_at)
               values (%s,%s,%s,%s,%s,%s,%s,%s,%s, now())
               on conflict (sport_id, athlete_ext) do update set
                 player_id=excluded.player_id, team_id=excluded.team_id, name=excluded.name,
                 position=excluded.position, status=excluded.status, detail=excluded.detail,
                 return_date=excluded.return_date, updated_at=now()""",
            inj_rows,
        )
        # quem saiu da lista de lesionados dos times que jogam agora volta a ficar ativo
        team_list = sorted({t for g in games for t in (g["home_team_id"], g["away_team_id"])})
        cur.execute("""delete from player_injuries where sport_id=%s and team_id = any(%s)
                       and not (athlete_ext = any(%s::text[]))""", (sport_id, team_list, list(injuries)))
        cur.execute("""update players set status='active' where sport_id=%s and team_id = any(%s)
                       and status <> 'active' and not (id = any(%s::bigint[]))""",
                    (sport_id, team_list, [p for p in (pids.get(a) for a in injuries) if p]))
        for a, inj in injuries.items():
            if pids.get(a):
                cur.execute("update players set status=%s where id=%s", (injury_level(inj["status"]), pids[a]))

        game_ids = sorted({gid for gid, _ in lineups})
        if game_ids:
            cur.execute("delete from game_lineups where game_id = any(%s)", (game_ids,))
        cur.executemany(
            """insert into game_lineups (game_id, team_id, athlete_ext, role, player_id, name, updated_at)
               values (%s,%s,%s,%s,%s,%s, now()) on conflict (game_id, athlete_ext, role) do nothing""",
            [(gid, teams.get(lu["team_ext"]), lu["athlete_ext"], lu["role"], pids.get(lu["athlete_ext"]), lu["name"])
             for gid, lu in lineups],
        )
    return ok, len(injuries), len(lineups)


def run(sports: list[str]) -> None:
    for sport_id in sports:
        try:
            prov = provider_for(sport_id)
        except Exception:
            continue
        if not hasattr(prov, "standings"):
            continue       # tênis/e-sports: sem esse contexto por enquanto
        try:
            with connect() as conn:
                n_st = _standings(conn, prov, sport_id)
                conn.commit()
                g, n_inj, n_lu = _context(conn, prov, sport_id)
                conn.commit()
            log.info("[%s] contexto: %d times na tabela, %d jogos lidos, %d desfalques, %d escalados/prováveis",
                     sport_id, n_st, g, n_inj, n_lu)
        except Exception:
            log.exception("[%s] falha no contexto (classificação/desfalques) — seguindo", sport_id)
