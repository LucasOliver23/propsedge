"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/client";
import { rpcErrorMessage } from "@/lib/constants";
import type { Profile, Side, TrackedBet } from "@/lib/types";

/** Usuário, bankroll e bilheteira — com Realtime em tracked_bets (Green/Red chega sozinho). */
export function useTrackedBets() {
  const supabase = getSupabase();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [bets, setBets] = useState<TrackedBet[]>([]);
  const [ready, setReady] = useState(false);

  const load = useCallback(async (uid: string) => {
    const [p, b] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", uid).single(),
      supabase.from("v_my_bets").select("*").order("created_at", { ascending: false }).limit(500),
    ]);
    if (p.data) setProfile(p.data as Profile);
    if (b.data) setBets(b.data as TrackedBet[]);
  }, [supabase]);

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(async ({ data }) => {
      if (!active) return;
      setUser(data.user);
      if (data.user) await load(data.user.id);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
      if (session?.user) load(session.user.id);
      else { setProfile(null); setBets([]); }
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, [supabase, load]);

  // Realtime: RLS garante que só chegam as apostas do próprio usuário
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`bets-${user.id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "tracked_bets", filter: `user_id=eq.${user.id}` },
        () => load(user.id))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [supabase, user, load]);

  /** chave `${market_id}:${side}` das apostas abertas — para marcar o botão "fixado" */
  const pinned = useMemo(
    () => new Set(bets.filter((b) => b.status === "pending" || b.status === "live").map((b) => `${b.market_id}:${b.side}`)),
    [bets],
  );

  const track = useCallback(async (marketId: number, side: Side, stake?: number, book?: string) => {
    const { error } = await supabase.rpc("track_prop", {
      p_market_id: marketId, p_side: side, p_stake: stake ?? null, p_bookmaker: book ?? null,
    });
    if (error) throw new Error(rpcErrorMessage(error.message));
    if (user) await load(user.id);
  }, [supabase, user, load]);

  /** Fixa prop com linha do modelo (sem odd de casa): usa a odd justa ou a odd que o usuário informar */
  const trackModel = useCallback(async (marketId: number, side: Side, stake?: number, odds?: number) => {
    const { error } = await supabase.rpc("track_prop_model", {
      p_market_id: marketId, p_side: side, p_odds: odds ?? null, p_stake: stake ?? null,
    });
    if (error) throw new Error(rpcErrorMessage(error.message));
    if (user) await load(user.id);
  }, [supabase, user, load]);

  /** Fixa mercado de time/jogo com a odd que o usuário encontrou na casa dele */
  const trackTeam = useCallback(async (args: {
    gameId: number; kind: "team" | "match"; teamId: number | null; statKey: string;
    side: Side; line: number; odds: number; stake?: number;
  }) => {
    const { error } = await supabase.rpc("track_team_market", {
      p_game_id: args.gameId, p_kind: args.kind, p_team_id: args.teamId, p_stat_key: args.statKey,
      p_side: args.side, p_line: args.line, p_odds: args.odds, p_stake: args.stake ?? null, p_bookmaker: null,
    });
    if (error) throw new Error(rpcErrorMessage(error.message));
    if (user) await load(user.id);
  }, [supabase, user, load]);

  const reload = useCallback(async () => { if (user) await load(user.id); }, [user, load]);

  const untrack = useCallback(async (betId: string) => {
    const { error } = await supabase.rpc("untrack_bet", { p_bet_id: betId });
    if (error) throw new Error(rpcErrorMessage(error.message));
    if (user) await load(user.id);
  }, [supabase, user, load]);

  return { user, profile, bets, pinned, ready, track, trackModel, trackTeam, untrack, reload };
}
