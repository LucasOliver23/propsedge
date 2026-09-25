"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getSupabase } from "@/lib/supabase/client";

function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const next = params.get("next") ?? "/props";
    const { error } = await getSupabase().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (error) { setState("error"); setMsg(error.message); } else setState("sent");
  }

  async function google() {
    const next = params.get("next") ?? "/props";
    await getSupabase().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
  }

  return (
    <div className="mx-auto mt-24 max-w-sm rounded-2xl border border-line bg-surface p-6">
      <h1 className="text-xl font-bold text-slate-100">Entrar no PropsEdge</h1>
      <p className="mt-1 text-sm text-slate-400">Você começa com R$ 1.000 de bankroll virtual.</p>
      {state === "sent" ? (
        <p className="mt-6 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300">Link enviado para {email}. Confira seu e-mail.</p>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-3">
          <input
            type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seu@email.com"
            className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-sky-400"
          />
          <button disabled={state === "sending"} className="w-full rounded-lg bg-sky-500 py-2 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-50">
            {state === "sending" ? "Enviando…" : "Receber link mágico"}
          </button>
          <button type="button" onClick={google} className="w-full rounded-lg border border-line py-2 text-sm text-slate-200 hover:bg-white/5">
            Continuar com Google
          </button>
          {state === "error" && <p className="text-sm text-rose-300">{msg}</p>}
        </form>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
