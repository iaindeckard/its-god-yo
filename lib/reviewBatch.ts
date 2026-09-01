import "server-only";
import { getSupabaseAdmin } from "./supabaseAdmin";
import { fetchKjvSourceMap } from "./kjvSource";
import type { ReviewSlot } from "./reviewQueue";

/**
 * Full-batch read for the proactive review view. Unlike getReviewQueue (which
 * only surfaces AI-FLAGGED slots, status='needs_review'), this returns EVERY
 * daily_slot for a track + optional date window, regardless of status — so a
 * reviewer can see and approve the whole upcoming batch, including AI-agreed
 * days the exceptions queue never shows. Reuses the same ReviewSlot shape as the
 * queue so the UI can share rendering; English and Spanish are each independently
 * approvable (summary counts below reflect English only — see isLangApproved in
 * BatchReview.tsx for the Spanish equivalent).
 */
export interface BatchSummary {
  total: number;
  approved: number; // approved or sent — send-ready
  needsReview: number;
  agreed: number;
  pending: number; // everything not yet approved/sent
}

export interface BatchResult {
  track: string;
  from: string | null;
  to: string | null;
  slots: ReviewSlot[];
  summary: BatchSummary;
}

export async function getBatchSlots(opts: {
  track: string;
  from?: string | null;
  to?: string | null;
}): Promise<BatchResult> {
  const admin = getSupabaseAdmin();
  let q = admin
    .from("daily_slots")
    .select(
      "id, scheduled_date, verse_ref, status, agreement_status, needs_review_reasons, ai_output_a, ai_output_b, final_translation, status_es, agreement_status_es, needs_review_reasons_es, ai_output_a_es, ai_output_b_es, final_translation_es",
    )
    .eq("theme_track", opts.track);
  if (opts.from) q = q.gte("scheduled_date", opts.from);
  if (opts.to) q = q.lte("scheduled_date", opts.to);
  const { data, error } = await q.order("scheduled_date", { ascending: true });
  if (error) throw new Error(`review_batch_query_failed: ${error.message}`);

  const rows = data ?? [];
  const sourceMap = await fetchKjvSourceMap(rows.map((r) => r.verse_ref));
  const slots: ReviewSlot[] = rows.map((r) => ({
    id: r.id,
    scheduled_date: r.scheduled_date,
    verse_ref: r.verse_ref,
    source_text: sourceMap[r.verse_ref] ?? null,
    en: {
      flagged: r.status === "needs_review",
      status: r.status,
      agreement: r.agreement_status,
      reasons: r.needs_review_reasons ?? [],
      a: r.ai_output_a,
      b: r.ai_output_b,
      final: r.final_translation,
    },
    es: {
      flagged: r.status_es === "needs_review",
      status: r.status_es,
      agreement: r.agreement_status_es,
      reasons: r.needs_review_reasons_es ?? [],
      a: r.ai_output_a_es,
      b: r.ai_output_b_es,
      final: r.final_translation_es,
    },
  }));

  const isApproved = (s: ReviewSlot) => s.en.status === "approved" || s.en.status === "sent";
  const summary: BatchSummary = {
    total: slots.length,
    approved: slots.filter(isApproved).length,
    needsReview: slots.filter((s) => s.en.status === "needs_review").length,
    agreed: slots.filter((s) => s.en.status === "agreed").length,
    pending: slots.filter((s) => !isApproved(s)).length,
  };

  return { track: opts.track, from: opts.from ?? null, to: opts.to ?? null, slots, summary };
}
