"""Índice de PRESSÃO ao vivo + ALERTAS de entrada (futebol).

A regra mora no banco, em refresh_live_pressure() (migração 0008), e é a mesma usada pela
Edge Function que roda a cada 1 minuto no Supabase. Aqui só chamamos essa função — assim não
existem duas implementações para sair do ar de sincronia.

    pontos = 3 x chutes no gol + 1 x chutes para fora + 1,5 x escanteios   (por 10 minutos)
    pressão (0-100) = pontos / 8 x 100, medida na janela dos últimos ~15 min de jogo

Alertas (1x por jogo/regra): gol maduro, pressão no 1º tempo, escanteios em ritmo alto,
time perdendo por 1 e pressionando.
"""
from __future__ import annotations

from db import connect
from jobs.common import log


def run() -> int:
    with connect() as conn, conn.cursor() as cur:
        cur.execute("select refresh_live_pressure() as n")
        n = cur.fetchone()["n"] or 0
        conn.commit()
    if n:
        log.info("ao vivo: %d alertas novos", n)
    return n
