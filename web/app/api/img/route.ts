import { NextResponse, type NextRequest } from "next/server";

/** Proxy de imagens (escudos da ESPN) para gerar PNG sem erro de CORS. Só domínios permitidos. */
const ALLOWED = [/\.espncdn\.com$/, /\.espn\.com$/];

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url");
  if (!raw) return new NextResponse("url obrigatória", { status: 400 });
  let url: URL;
  try { url = new URL(raw); } catch { return new NextResponse("url inválida", { status: 400 }); }
  if (url.protocol !== "https:" || !ALLOWED.some((r) => r.test(url.hostname))) {
    return new NextResponse("domínio não permitido", { status: 403 });
  }
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 86400 } });
  if (!res.ok) return new NextResponse("falha ao buscar imagem", { status: 502 });
  return new NextResponse(res.body, {
    headers: {
      "Content-Type": res.headers.get("content-type") ?? "image/png",
      "Cache-Control": "public, max-age=86400, s-maxage=604800",
    },
  });
}
