"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import type { PropRow } from "@/lib/types";

/**
 * Carrega o painel do dia (v_props_board) e mantém atualizado via Realtime:
 * quando o worker recalcula `prop_analytics` ou muda status de `games`,
 * refazemos a consulta (com debounce p/ agrupar rajadas de updates).
 */
export function usePropsBoard(initial: PropRow[] = []) {
  const [rows, setRows] = useState<PropRow[]>(initial);
  const [loading, setLoading] = useState(initial.length === 0);
  const [error, setError] = useState<string | null>(null);
  // Começa null nos dois lados (servidor e cliente) de propósito: se desse new Date() aqui,
  // o valor renderizado na primeira pintura do servidor (SSR) e do navegador seriam instantes
  // diferentes (e em fusos diferentes) — React detecta a divergência e quebra a hidratação.
  // Setamos o valor de verdade só depois de montar, com useEffect (só roda no cliente).
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (initial.length) setUpdatedAt(new Date());
  }, [initial.length]);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const load = useCallback(async () => {
    const { data, error } = await getSupabase()
      .from("v_props_board")
      .select("*")
      .order("confidence", { ascending: false })
      .limit(5000);
    if (error) setError(error.message);
    else {
      setRows((data ?? []) as PropRow[]);
      setError(null);
      setUpdatedAt(new Date());
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!initial.length) load();
    const refresh = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(load, 1500);
    };
    const channel = getSupabase()
      .channel("props-board")
      .on("postgres_changes", { event: "*", schema: "public", table: "prop_analytics" }, refresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "games" }, refresh)
      .subscribe();
    return () => {
      clearTimeout(timer.current);
      getSupabase().removeChannel(channel);
    };
  }, [load, initial.length]);

  return { rows, loading, error, updatedAt, reload: load };
}
