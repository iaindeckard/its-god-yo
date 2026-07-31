import "server-only";
import { getSupabaseAdmin } from "./supabaseAdmin";

/**
 * Canonical KJV source text for a set of daily_slots.verse_ref strings
 * ("Book Chapter:Verse"). Returns a ref -> source_text map so the review UI can
 * show the ground-truth verse next to the AI reword outputs — you can't judge a
 * reword's faithfulness without the source it's rewording. Reference data only
 * (public KJV text) via the get_kjv_text_for_refs RPC.
 */
export async function fetchKjvSourceMap(verseRefs: string[]): Promise<Record<string, string>> {
  const refs = [...new Set(verseRefs.filter(Boolean))];
  if (refs.length === 0) return {};
  const { data, error } = await getSupabaseAdmin().rpc("get_kjv_text_for_refs", { p_refs: refs });
  if (error) throw new Error(`kjv_source_query_failed: ${error.message}`);
  const map: Record<string, string> = {};
  for (const row of (data ?? []) as Array<{ reference: string; source_text: string }>) {
    map[row.reference] = row.source_text;
  }
  return map;
}
