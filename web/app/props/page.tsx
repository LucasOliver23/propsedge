import { PropsDashboard } from "@/components/props/PropsDashboard";
import { getServerSupabase } from "@/lib/supabase/server";
import type { PropRow } from "@/lib/types";

export const dynamic = "force-dynamic";

/** SSR da primeira carga (rápido e indexável); depois o cliente assume com Realtime. */
export default async function PropsPage() {
  const { data } = await getServerSupabase()
    .from("v_props_board")
    .select("*")
    .order("confidence", { ascending: false })
    .limit(5000);
  return <PropsDashboard initialRows={(data ?? []) as PropRow[]} />;
}
