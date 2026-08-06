import "server-only";
import { getSupabaseAdmin } from "./supabaseAdmin";
import type { Staff } from "./rbac";

/**
 * Divine-pronoun correction review batch (LOCKED policy 2026-08-06: lowercase
 * pronouns referring to God are flag-for-review, NEVER auto-fixed blindly, because
 * a "he" in the same verse can refer to a human figure). An AI pass proposed a
 * corrected final_translation for each approved slot flagged
 * 'divine_capitalization:pronoun_review'; a reviewer approves/rejects each here.
 *
 * Approve  -> the proposed text is written to daily_slots.final_translation and the
 *             pronoun_review flag is cleared (the slot stays 'approved').
 * Reject   -> the proposal is discarded; the slot's text and flag are untouched.
 *
 * Same review-before-use model as lib/themeTags (verse_theme_tags). All access is
 * via the service-role admin client; the table has RLS on with no public policies.
 */

const PRONOUN_FLAG = "divine_capitalization:pronoun_review";

export interface PronounProposal {
  id: string;
  daily_slot_id: string;
  verse_ref: string;
  original_text: string;
  proposed_text: string;
  status: string;
  reviewed_at: string | null;
}

export interface PronounProposalSummary {
  proposed: number;
  approved: number;
  rejected: number;
}

export async function getPronounSummary(): Promise<PronounProposalSummary> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from("pronoun_correction_proposals").select("status");
  if (error) throw new Error(`pronoun_summary_failed: ${error.message}`);
  const s = { proposed: 0, approved: 0, rejected: 0 };
  for (const r of data ?? []) {
    if (r.status === "proposed") s.proposed++;
    else if (r.status === "approved") s.approved++;
    else if (r.status === "rejected") s.rejected++;
  }
  return s;
}

/** Proposals at a given status (default the pending queue), oldest verse first. */
export async function getPronounProposals(status = "proposed"): Promise<PronounProposal[]> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("pronoun_correction_proposals")
    .select("id, daily_slot_id, verse_ref, original_text, proposed_text, status, reviewed_at")
    .eq("status", status)
    .order("verse_ref", { ascending: true });
  if (error) throw new Error(`pronoun_proposals_failed: ${error.message}`);
  return (data ?? []) as PronounProposal[];
}

/**
 * Approve (apply the proposed text + clear the flag) or reject (discard) one
 * proposal. Approving is the ONLY path that writes daily_slots.final_translation;
 * drafting/populating the batch never does. Records the reviewer for the audit trail.
 */
export async function reviewPronounProposal(id: string, decision: "approve" | "reject", staff: Staff): Promise<PronounProposal> {
  const admin = getSupabaseAdmin();
  const { data: p, error: rErr } = await admin
    .from("pronoun_correction_proposals")
    .select("id, daily_slot_id, proposed_text, status")
    .eq("id", id)
    .maybeSingle();
  if (rErr) throw new Error(`pronoun_proposal_read_failed: ${rErr.message}`);
  if (!p) throw new Error("pronoun_proposal_not_found");
  if (p.status !== "proposed") throw new Error(`already_${p.status}`);

  if (decision === "approve") {
    // Apply the corrected text and clear the pronoun_review flag on the slot.
    const { data: slot, error: sErr } = await admin
      .from("daily_slots").select("needs_review_reasons").eq("id", p.daily_slot_id).maybeSingle();
    if (sErr) throw new Error(`slot_read_failed: ${sErr.message}`);
    const reasons = ((slot?.needs_review_reasons ?? []) as string[]).filter((r) => r !== PRONOUN_FLAG);
    const { error: uErr } = await admin
      .from("daily_slots")
      .update({ final_translation: p.proposed_text, needs_review_reasons: reasons, updated_at: new Date().toISOString() })
      .eq("id", p.daily_slot_id);
    if (uErr) throw new Error(`slot_update_failed: ${uErr.message}`);
  }

  const status = decision === "approve" ? "approved" : "rejected";
  const { data: updated, error: puErr } = await admin
    .from("pronoun_correction_proposals")
    .update({ status, reviewed_by: staff.userId, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, daily_slot_id, verse_ref, original_text, proposed_text, status, reviewed_at")
    .single();
  if (puErr) throw new Error(`pronoun_proposal_update_failed: ${puErr.message}`);
  return updated as PronounProposal;
}
