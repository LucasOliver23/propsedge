"""Complemento grátis para a MLB usando a API oficial (statsapi.mlb.com):

  * arremessador provável (se a ESPN ainda não informou)
  * escalação confirmada + ordem de rebatedores -> game_lineups (role='starter', batting_order 1..9)

Com a escalação saindo, as props de rebatidas passam a considerar só os titulares do dia
(jobs/model_props.py) e o site mostra "TIT 3º" no jogador. Roda junto com o contexto (agenda, a cada 3h)
e no ciclo de 15 min para os jogos que começam em até 6h (quando a escalação costuma sair).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher

from db import connect
from jobs.common import log
from providers.mlb_official import MLBOfficial

LINEUP_WINDOW_H = 6        # só busca escalação de jogos que começam em até 6h (economiza chamadas)

GAMES_SQL = """
select g.id, g.start_time, g.home_team_id, g.away_team_id, ht.name as home, at.name as away
from games g join teams ht on ht.id = g.home_team_id join teams at on at.id = g.away_team_id
where g.sport_id = 'mlb' and g.status = 'scheduled'
  and g.start_time between now() - interval '15 minutes' and now() + interval '36 hours'
"""


def _same(a: str, b: str) -> bool:
    a, b = a.lower().strip(), b.lower().strip()
    return a == b or SequenceMatcher(None, a, b).ratio() >= 0.8


def _match(ours: dict, theirs: list[dict]) -> dict | None:
    for t in theirs:
        if abs((t["start"] - ours["start_time"]).total_seconds()) <= 3 * 3600 \
                and _same(t["home"], ours["home"]) and _same(t["away"], ours["away"]):
            return t
    return None


def run(lineups_only: bool = False) -> None:
    api = MLBOfficial()
    now = datetime.now(timezone.utc)
    with connect() as conn, conn.cursor() as cur:
        cur.execute(GAMES_SQL)
        games = cur.fetchall()
        if lineups_only:
            games = [g for g in games if g["start_time"] - now <= timedelta(hours=LINEUP_WINDOW_H)]
        if not games:
            return
        try:
            sched = api.schedule((now - timedelta(days=1)).date(), (now + timedelta(days=2)).date())
        except Exception as e:
            log.warning("MLB oficial indisponível (%s) — seguindo só com a ESPN", e)
            return

        n_prob = n_lu = 0
        for g in games:
            m = _match(g, sched)
            if not m:
                continue
            sides = (("home", g["home_team_id"]), ("away", g["away_team_id"]))

            # 1) arremessador provável (só se a ESPN não deu)
            for side, team_id in sides:
                pp = m.get(f"{side}_prob")
                if not pp:
                    continue
                cur.execute("""select 1 from game_lineups where game_id=%s and team_id=%s
                               and role='probable_pitcher' limit 1""", (g["id"], team_id))
                if cur.fetchone():
                    continue
                cur.execute("select match_player(%s, array[%s]::bigint[]) as pid", (pp["name"], team_id))
                cur.execute(
                    """insert into game_lineups (game_id, team_id, athlete_ext, role, player_id, name, updated_at)
                       values (%s,%s,%s,'probable_pitcher',%s,%s, now()) on conflict do nothing""",
                    (g["id"], team_id, f"mlb:{pp['id']}", cur.fetchone()["pid"], pp["name"]),
                )
                n_prob += 1

            # 2) escalação confirmada (ordem de rebatedores)
            if g["start_time"] - now > timedelta(hours=LINEUP_WINDOW_H) or not m.get("game_pk"):
                continue
            try:
                lu = api.lineup(m["game_pk"])
            except Exception as e:
                log.warning("escalação MLB %s indisponível: %s", m["game_pk"], e)
                continue
            for side, team_id in sides:
                if len(lu[side]) < 9:
                    continue            # escalação ainda não saiu
                cur.execute("delete from game_lineups where game_id=%s and team_id=%s and role='starter'",
                            (g["id"], team_id))
                for p in lu[side]:
                    cur.execute("select match_player(%s, array[%s]::bigint[]) as pid", (p["name"], team_id))
                    pid = cur.fetchone()["pid"]
                    cur.execute(
                        """insert into game_lineups (game_id, team_id, athlete_ext, role, player_id, name,
                                                     batting_order, updated_at)
                           values (%s,%s,%s,'starter',%s,%s,%s, now()) on conflict do nothing""",
                        (g["id"], team_id, f"mlb:{p['id']}", pid, p["name"], p["order"]),
                    )
                    n_lu += 1
        conn.commit()
    log.info("MLB oficial: %d arremessadores prováveis, %d rebatedores escalados", n_prob, n_lu)
