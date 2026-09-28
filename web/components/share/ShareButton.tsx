"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ImageDown, Loader2 } from "lucide-react";
import { exportNode } from "@/lib/shareImage";

export type ShareFormat = "post" | "stories";
export const FORMAT_SIZE: Record<ShareFormat, { w: number; h: number }> = {
  post: { w: 1080, h: 1350 },     // Instagram feed 4:5
  stories: { w: 1080, h: 1920 },  // Stories / Reels 9:16
};

interface Props {
  filename: string;
  render: (format: ShareFormat) => ReactNode;
}

/** Botões "Post" e "Stories": monta a arte fora da tela, espera os escudos carregarem e gera o PNG. */
export function ShareButton({ filename, render }: Props) {
  const [format, setFormat] = useState<ShareFormat | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!format || !ref.current) return;
    const node = ref.current;
    let cancelled = false;
    (async () => {
      try {
        await document.fonts?.ready;
        const imgs = Array.from(node.querySelectorAll("img"));
        await Promise.all(imgs.map((img) => (img.complete ? Promise.resolve() : img.decode().catch(() => undefined))));
        if (!cancelled) await exportNode(node, `${filename}-${format}.png`);
      } catch (e) {
        setErr("Não foi possível gerar a imagem.");
        console.error(e);
      } finally {
        if (!cancelled) setFormat(null);
      }
    })();
    return () => { cancelled = true; };
  }, [format, filename]);

  const size = format ? FORMAT_SIZE[format] : null;

  return (
    <div className="flex items-center gap-1.5">
      {(["post", "stories"] as ShareFormat[]).map((f) => (
        <button key={f} type="button" onClick={() => { setErr(null); setFormat(f); }} disabled={!!format}
          className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs text-slate-300 hover:border-sky-400 hover:text-sky-300 disabled:opacity-50">
          {format === f ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageDown className="h-3.5 w-3.5" />}
          {f === "post" ? "Post" : "Stories"}
        </button>
      ))}
      {err && <span className="text-xs text-rose-300">{err}</span>}
      {format && size && typeof document !== "undefined" &&
        createPortal(
          <div style={{ position: "fixed", left: -20000, top: 0, pointerEvents: "none" }} aria-hidden>
            <div ref={ref} style={{ width: size.w, height: size.h }}>{render(format)}</div>
          </div>,
          document.body,
        )}
    </div>
  );
}
