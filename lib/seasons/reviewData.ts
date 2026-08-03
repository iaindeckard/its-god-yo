import "server-only";
import { getSupabaseAdmin } from "../supabaseAdmin";

/** Admin view of the seasonal review queue: batches + their items. */
export interface SeasonReviewBatch {
  id: string;
  season_key: string;
  liturgical_year: number;
  status: string;
  total_items: number;
  approved_items: number;
  season_start: string | null;
  review_opens_at: string | null;
  t14_alerted_at: string | null;
}
export interface SeasonReviewItem {
  id: string;
  send_date: string;
  day_index: number;
  verse_ref: string | null;
  verse_text: string | null;
  status: string;
  reject_reason: string | null;
}

export async function getSeasonReviewBatches(): Promise<SeasonReviewBatch[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("season_content_batches")
    .select("id, season_key, liturgical_year, status, total_items, approved_items, season_start, review_opens_at, t14_alerted_at")
    .order("season_start", { ascending: true });
  if (error) throw new Error(`getSeasonReviewBatches: ${error.message}`);
  return (data ?? []) as SeasonReviewBatch[];
}

export async function getSeasonReviewItems(batchId: string): Promise<SeasonReviewItem[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("season_content_items")
    .select("id, send_date, day_index, verse_ref, verse_text, status, reject_reason")
    .eq("batch_id", batchId)
    .order("day_index", { ascending: true });
  if (error) throw new Error(`getSeasonReviewItems: ${error.message}`);
  return (data ?? []) as SeasonReviewItem[];
}
