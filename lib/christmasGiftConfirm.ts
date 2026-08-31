import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Christmas Scheduled Gift — recipient confirmation (the YES path).
 *
 * A confirmed recipient becomes a subscriber with NO Stripe subscription. This creates
 * that subscription-less `pending_signups` row (status='prepaid_active'), starts the
 * one-year service window from THIS moment (recipient confirmation, never purchase or
 * release), applies the free DM-from-Him bonus flag if the purchase included it, and
 * links the consent + purchase together.
 *
 * Idempotent under Twilio retries: the confirmation_sent -> confirmed transition on the
 * purchase is a single guarded UPDATE, so exactly one inbound wins and creates the
 * subscriber; a retry sees the already-confirmed row and returns it without duplicating.
 */

// The gift plan's Stripe price (catalog reference). A prepaid Scheduled Gift has no
// Stripe subscription, but pending_signups.base_price_id is NOT NULL and this is the
// semantically correct catalog price. Keep in sync with the igy_gift_annual price.
export const CHRISTMAS_GIFT_BASE_PRICE_ID = "price_1TvfM0GZ9WDMHywotCWp8Lrm";
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export interface ConfirmResult {
  status: "confirmed" | "already_confirmed" | "not_pending";
  pendingSignupId?: string;
}

interface ClaimedPurchase {
  id: string;
  language: string | null;
  dmfh_bonus_included: boolean | null;
  stripe_customer_id: string;
  purchaser_email: string;
  purchaser_user_id: string | null;
}

export async function confirmScheduledGift(
  admin: SupabaseClient,
  args: { consentId: string; purchaseId: string; replyBody: string; nowMs?: number },
): Promise<ConfirmResult> {
  const nowMs = args.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const serviceEndIso = new Date(nowMs + ONE_YEAR_MS).toISOString();

  // Claim: only ONE inbound wins the confirmation_sent -> confirmed transition. The
  // guarded UPDATE ... RETURNING is atomic per row, so a concurrent retry gets 0 rows.
  const { data: claimedRows, error: claimErr } = await admin
    .from("christmas_gift_2026_purchases")
    .update({ status: "confirmed", confirmed_at: nowIso, updated_at: nowIso })
    .eq("id", args.purchaseId)
    .eq("status", "confirmation_sent")
    .select("id, language, dmfh_bonus_included, stripe_customer_id, purchaser_email, purchaser_user_id");
  if (claimErr) throw new Error(`christmas_confirm_claim_failed: ${claimErr.message}`);

  if (!claimedRows || claimedRows.length === 0) {
    // Did not claim: either an already-confirmed retry (return its signup) or not in a
    // confirmable state.
    const { data: existing } = await admin
      .from("christmas_gift_2026_purchases")
      .select("status, pending_signup_id")
      .eq("id", args.purchaseId)
      .maybeSingle();
    const ex = existing as { status: string; pending_signup_id: string | null } | null;
    if (ex?.status === "confirmed" && ex.pending_signup_id) {
      return { status: "already_confirmed", pendingSignupId: ex.pending_signup_id };
    }
    return { status: "not_pending" };
  }

  const purchase = claimedRows[0] as ClaimedPurchase;
  const lang = purchase.language === "es" ? "es" : "en";
  const dm = !!purchase.dmfh_bonus_included;

  // Create the subscription-less prepaid subscriber. The gifted year is anchored here.
  const { data: ps, error: psErr } = await admin
    .from("pending_signups")
    .insert({
      language: lang,
      plan_key: "christmas_gift_2026",
      base_price_id: CHRISTMAS_GIFT_BASE_PRICE_ID,
      dm_addon: dm,
      dm_addon_free_until: dm ? serviceEndIso : null,
      teen_consent_id: args.consentId,
      status: "prepaid_active",
      service_period_end: serviceEndIso,
      theme_track: "general",
      stripe_customer_id: purchase.stripe_customer_id,
      purchaser_email: purchase.purchaser_email,
      purchaser_user_id: purchase.purchaser_user_id,
    })
    .select("id")
    .single();
  if (psErr || !ps) throw new Error(`christmas_confirm_signup_failed: ${psErr?.message ?? "no row"}`);
  const pendingSignupId = (ps as { id: string }).id;

  // Confirm the consent + set the back-reference (separate statement so the STOP
  // resolver's back-reference path works).
  const { error: cErr } = await admin
    .from("consent_log")
    .update({
      consent_status: "confirmed",
      pending_signup_id: pendingSignupId,
      confirmation_reply_received: true,
      confirmation_reply_at: nowIso,
      confirmation_reply_raw: args.replyBody,
    })
    .eq("id", args.consentId);
  if (cErr) throw new Error(`christmas_confirm_consent_failed: ${cErr.message}`);

  // Link the purchase to its subscriber row.
  const { error: linkErr } = await admin
    .from("christmas_gift_2026_purchases")
    .update({ pending_signup_id: pendingSignupId, updated_at: nowIso })
    .eq("id", args.purchaseId);
  if (linkErr) throw new Error(`christmas_confirm_link_failed: ${linkErr.message}`);

  return { status: "confirmed", pendingSignupId };
}
