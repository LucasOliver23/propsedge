"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Loader2, Pin, PinOff } from "lucide-react";

interface Props {
  pinned: boolean;
  defaultStake: number;
  disabled?: boolean;
  onConfirm: (stake: number) => Promise<void>;
}

/** Botão "fixar" com popover de stake. A aposta vai para a Bilheteira e é liquidada automaticamente. */
export function PinButton({ pinned, defaultStake, disabled, onConfirm }: Props) {
  const [open, setOpen] = useState(false);
  const [stake, setStake] = useState(defaultStake);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setStake(defaultStake), [defaultStake]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  async function confirm() {
    setBusy(true);
    setErr(null);
    try {
      await onConfirm(stake);
      setOpen(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        disabled={disabled || pinned}
        onClick={() => setOpen((o) => !o)}
        aria-label={pinned ? "Prop fixada" : "Fixar prop"}
        className={clsx(
          "flex h-9 w-9 items-center justify-center rounded-lg border transition",
          pinned
            ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
            : "border-line text-slate-300 hover:border-sky-400 hover:text-sky-300",
          disabled && !pinned && "cursor-not-allowed opacity-40",
        )}
      >
        {pinned ? <Pin className="h-4 w-4 fill-current" /> : <Pin className="h-4 w-4" />}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-30 w-60 rounded-xl border border-line bg-elevated p-3 shadow-2xl">
          <label className="mb-1 block text-xs text-slate-400" htmlFor="stake">Stake (saldo virtual)</label>
          <div className="flex gap-2">
            <input
              id="stake"
              type="number"
              min={1}
              step={1}
              value={stake}
              onChange={(e) => setStake(Number(e.target.value))}
              className="w-full rounded-lg border border-line bg-bg px-2 py-1.5 text-sm tabular-nums outline-none focus:border-sky-400"
            />
            <button
              type="button"
              onClick={confirm}
              disabled={busy || stake <= 0}
              className="flex items-center gap-1 rounded-lg bg-sky-500 px-3 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Fixar"}
            </button>
          </div>
          <div className="mt-2 flex gap-1">
            {[0.5, 1, 2].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setStake(defaultStake * m)}
                className="flex-1 rounded-md bg-white/5 py-1 text-xs text-slate-300 hover:bg-white/10"
              >
                {m}u
              </button>
            ))}
          </div>
          {err && (
            <p className="mt-2 flex items-start gap-1 text-xs text-rose-300">
              <PinOff className="mt-0.5 h-3 w-3 shrink-0" /> {err}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
