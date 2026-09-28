import { toPng } from "html-to-image";

/** Escudos passam pelo proxy /api/img (mesma origem) para entrar no PNG. */
export const proxied = (src: string | null | undefined) => (src ? `/api/img?url=${encodeURIComponent(src)}` : null);

/** Gera o PNG de um elemento e baixa (ou abre o compartilhamento nativo no celular). */
export async function exportNode(node: HTMLElement, filename: string) {
  const dataUrl = await toPng(node, { pixelRatio: 1, cacheBust: true, backgroundColor: "#0b0f17" });
  const blob = await (await fetch(dataUrl)).blob();
  const file = new File([blob], filename, { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.canShare?.({ files: [file] }) && /Mobi|Android/i.test(navigator.userAgent)) {
    try { await nav.share({ files: [file], title: "PropsEdge" }); return; } catch { /* usuário cancelou: baixa */ }
  }
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}
