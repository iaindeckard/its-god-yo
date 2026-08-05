import "server-only";
import { getSupabaseAdmin } from "./supabaseAdmin";
import { invokeReviewFn } from "./reviewFunctions";
import type { Staff } from "./rbac";

/**
 * Theme/mood verse tagging — the human review side. An AI first pass
 * (propose-theme-verses edge function) writes 'proposed' verse_theme_tags; a
 * reviewer approves/rejects them here before a track's generation can use them.
 * Only 'approved' tags feed generation. This is the same review-before-use
 * safety model as the translation queue, applied to selection.
 */

export interface TrackSummary {
  key: string;
  label: string;
  description: string | null;
  sort_order: number;
  is_default: boolean;
  proposed: number;
  approved: number;
  rejected: number;
}

export interface TagRow {
  id: string;
  verse_ref: string;
  status: string;
  confidence: number | null;
  rationale: string | null;
  proposed_by: string | null;
  kjv_text: string | null;
}

/** Per-track counts by status (excludes 'general' — it isn't tagged). */
export async function getTrackSummaries(): Promise<TrackSummary[]> {
  const admin = getSupabaseAdmin();
  const [{ data: tracks, error: tErr }, { data: tags, error: gErr }] = await Promise.all([
    admin.from("theme_tracks").select("key, label, description, sort_order, is_default").order("sort_order"),
    admin.from("verse_theme_tags").select("theme_track, status"),
  ]);
  if (tErr) throw new Error(`tracks_query_failed: ${tErr.message}`);
  if (gErr) throw new Error(`tags_query_failed: ${gErr.message}`);

  const counts: Record<string, { proposed: number; approved: number; rejected: number }> = {};
  for (const t of tags ?? []) {
    const c = (counts[t.theme_track] ??= { proposed: 0, approved: 0, rejected: 0 });
    if (t.status === "proposed") c.proposed++;
    else if (t.status === "approved") c.approved++;
    else if (t.status === "rejected") c.rejected++;
  }
  return (tracks ?? [])
    .filter((t) => t.key !== "general")
    .map((t) => ({
      key: t.key,
      label: t.label,
      description: t.description,
      sort_order: t.sort_order,
      is_default: t.is_default,
      proposed: counts[t.key]?.proposed ?? 0,
      approved: counts[t.key]?.approved ?? 0,
      rejected: counts[t.key]?.rejected ?? 0,
    }));
}

/** Tags for a track at a given status, with KJV source text for review. */
export async function getTagsForTrack(track: string, status = "proposed"): Promise<TagRow[]> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("get_theme_tags_detailed", { p_track: track, p_status: status });
  if (error) throw new Error(`tag_detail_query_failed: ${error.message}`);
  return (data ?? []) as TagRow[];
}

/** Approve or reject a proposed tag. Records the reviewer for the audit trail. */
export async function reviewTag(id: string, decision: "approve" | "reject", staff: Staff): Promise<TagRow> {
  const admin = getSupabaseAdmin();
  const status = decision === "approve" ? "approved" : "rejected";
  const { error } = await admin
    .from("verse_theme_tags")
    .update({ status, reviewed_by: staff.userId, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`tag_review_failed: ${error.message}`);
  // Return the refreshed row (with text) for the client.
  const { data, error: rErr } = await admin
    .from("verse_theme_tags").select("id, verse_ref, status, confidence, rationale, proposed_by, theme_track").eq("id", id).single();
  if (rErr) throw new Error(`tag_reread_failed: ${rErr.message}`);
  return { ...(data as Omit<TagRow, "kjv_text">), kjv_text: null };
}

/**
 * Trigger the AI first pass for a track by invoking the propose-theme-verses
 * edge function. Forwards the signed-in staff member's access token (via
 * invokeReviewFn) so the function's auth.getUser + has_permission('content.generate')
 * gate passes — the service-role key resolves to no user and 401s, so it must not
 * be used here. The route already gated the caller with a content.theme_tags
 * permission; content.generate is re-checked inside the function.
 */
export async function proposeForTrack(track: string, sampleSize?: number): Promise<unknown> {
  return invokeReviewFn("propose-theme-verses", { theme_track: track, sample_size: sampleSize });
}
