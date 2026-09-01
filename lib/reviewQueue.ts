import "server-only";
import { getSupabaseAdmin } from "./supabaseAdmin";
import { fetchKjvSourceMap } from "./kjvSource";

/**
 * The review queue reads daily_slots flagged for review on EITHER language.
 * A slot can be flagged on English (status='needs_review'), Spanish
 * (status_es='needs_review'), or both. Each dimension has its own approve /
 * reject-translation Edge Functions (review-approve[-es], review-reject-
 * translation[-es]); only "reject verse" is English-only, since verse_ref is
 * shared across both languages on the row.
 */
export interface ReviewLangSide {
  flagged: boolean;
  status: string | null;
  agreement: string | null; // agreement_status — reflects the AI similarity result
  reasons: string[]; // ai_disagreement / incomplete_sentence
  a: string | null;
  b: string | null;
  final: string | null;
}
export interface ReviewSlot {
  id: string;
  scheduled_date: string;
  verse_ref: string;
  source_text: string | null; // canonical KJV text for verse_ref
  en: ReviewLangSide;
  es: ReviewLangSide;
}

export async function getReviewQueue(): Promise<ReviewSlot[]> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("daily_slots")
    .select(
      "id, scheduled_date, verse_ref, status, agreement_status, needs_review_reasons, ai_output_a, ai_output_b, final_translation, status_es, agreement_status_es, needs_review_reasons_es, ai_output_a_es, ai_output_b_es, final_translation_es",
    )
    .or("status.eq.needs_review,status_es.eq.needs_review")
    .order("scheduled_date", { ascending: true });
  if (error) throw new Error(`review_queue_query_failed: ${error.message}`);

  const rows = data ?? [];
  const sourceMap = await fetchKjvSourceMap(rows.map((r) => r.verse_ref));
  return rows.map((r) => ({
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
}
