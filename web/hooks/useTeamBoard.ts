"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import type { TeamMarketRow } from "@/lib/types";

/** Mercados de time/jogo das próximas 72h (v_team_board) com refresh via Realtime em `games`. */
export function useTeamBoard() {
  const [rows, setRows] = useState<TeamMarketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const load = useCallback(async () => {
    const { data, error } = await getSupabase()
      .from("v_team_board")
      .select("*")
      .order("score", { ascending: false })
      .limit(5000);
    if (error) setError(error.message);
    else { setRows((data ?? []) as TeamMarketRow[]); setError(null); }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const ch = getSupabase()
      .channel("team-board")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "games" }, () => {
        clearTimeout(timer.current);
        timer.current = setTimeout(load, 2000);
      })
      .subscribe();
    return () => { clearTimeout(timer.current); getSupabase().removeChannel(ch); };
  }, [load]);

  return { rows, loading, error, reload: load };
}
