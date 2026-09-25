import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

/** Retorno do magic link / OAuth */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/props";
  if (code) await getServerSupabase().auth.exchangeCodeForSession(code);
  return NextResponse.redirect(new URL(next, url.origin));
}
