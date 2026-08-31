import type { getSupabaseAdmin } from "./supabaseAdmin";

/**
 * A pending_signup for a CONFIRMED subscriber. Used to gate the confirmed-subscriber
 * STOP path. Excludes 'awaiting_confirmation' (still pending, handled by the pending
 * path) and 'canceled' (already off).
 *
 * 'prepaid_active' is a confirmed Christmas Scheduled Gift recipient who has NO Stripe
 * subscription (prepaid one year). It MUST be here so a STOP from such a recipient is
 * recognized and their signup canceled: cancelSubscriptionForSignup flips the row to
 * 'canceled' and skips the Stripe cancel when stripe_subscription_id is null. Without
 * it, STOP would opt out the consent row (which already halts sends) but leave the
 * pending_signup un-canceled. Shipped together with dailySend's null-subscription
 * tolerance so no prepaid_active recipient can receive a send that STOP can't stop.
 */
export const ACTIVE_SIGNUP_STATUSES = ["subscription_created", "active", "prepaid_active"];

/**
 * Resolve the ACTIVE pending_signup that owns a consent row, tolerant of a missing
 * back-reference. Tries the back-reference (consent_log.pending_signup_id) first,
 * then the ALWAYS-set forward link (pending_signups.teen_consent_id /
 * plus_one_consent_id = consentId).
 *
 * Why both: the back-reference was not always populated. A null there used to make
 * the STOP->cancel matcher skip the row entirely, so a confirmed subscriber could
 * text STOP, be marked opted_out, and KEEP GETTING BILLED because Stripe was never
 * canceled. Falling back to the forward link closes that gap.
 *
 * Kept in its own module (no "server-only", no runtime Supabase import) so the
 * resolver and its unit tests stay dependency-free.
 */
export async function resolveActiveSignupForConsent(
  admin: ReturnType<typeof getSupabaseAdmin>,
  consentId: string,
  backrefSignupId: string | null,
): Promise<{ id: string } | null> {
  if (backrefSignupId) {
    const { data } = await admin
      .from("pending_signups")
      .select("id, status")
      .eq("id", backrefSignupId)
      .in("status", ACTIVE_SIGNUP_STATUSES)
      .maybeSingle();
    if (data) return { id: (data as { id: string }).id };
  }
  const { data: fwd } = await admin
    .from("pending_signups")
    .select("id, status")
    .or(`teen_consent_id.eq.${consentId},plus_one_consent_id.eq.${consentId}`)
    .in("status", ACTIVE_SIGNUP_STATUSES)
    .limit(1)
    .maybeSingle();
  return fwd ? { id: (fwd as { id: string }).id } : null;
}
