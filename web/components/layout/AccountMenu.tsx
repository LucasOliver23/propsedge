"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { LogOut, User, Wallet } from "lucide-react";
import { useTrackedBets } from "@/hooks/useTrackedBets";
import { getSupabase } from "@/lib/supabase/client";
import { brl } from "@/lib/format";

/** Menu de acesso (avatar/login) no canto direito da nav — entrar, ver bankroll, sair. */
export function AccountMenu() {
  const { user, profile } = useTrackedBets();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (!user) {
    return (
      <Link
        href="/login"
        className="ml-auto shrink-0 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-slate-200 transition hover:border-brand-400 hover:text-brand-200"
      >
        Entrar
      </Link>
    );
  }

  const initial = (profile?.username || user.email || "?").charAt(0).toUpperCase();

  return (
    <div ref={ref} className="relative ml-auto shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          "flex h-9 w-9 items-center justify-center rounded-full border text-sm font-bold transition",
          open ? "border-brand-400 bg-brand-500/15 text-brand-200" : "border-line text-slate-200 hover:border-slate-500",
        )}
        aria-label="Menu da conta"
      >
        {initial}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-56 overflow-hidden rounded-xl border border-line bg-elevated shadow-xl">
          <div className="border-b border-line px-3 py-2.5">
            <p className="truncate text-sm font-semibold text-slate-100">{profile?.username || user.email}</p>
            {profile?.username && <p className="truncate text-xs text-slate-500">{user.email}</p>}
          </div>
          <div className="flex items-center justify-between px-3 py-2.5 text-sm text-slate-300">
            <span className="flex items-center gap-1.5"><Wallet className="h-3.5 w-3.5" /> Bankroll</span>
            <span className="font-display font-semibold tabular-nums text-brand-200">
              {profile ? brl(Number(profile.bankroll)) : "—"}
            </span>
          </div>
          <Link
            href="/bets"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2.5 text-sm text-slate-300 transition hover:bg-white/5"
          >
            <User className="h-3.5 w-3.5" /> Minha bilheteira
          </Link>
          <button
            onClick={async () => { await getSupabase().auth.signOut(); setOpen(false); }}
            className="flex w-full items-center gap-2 border-t border-line px-3 py-2.5 text-left text-sm text-rose-300 transition hover:bg-rose-500/10"
          >
            <LogOut className="h-3.5 w-3.5" /> Sair
          </button>
        </div>
      )}
    </div>
  );
}
