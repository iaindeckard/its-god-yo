import "server-only";
import { getStripe } from "../stripe";
import { getSupabaseAdmin } from "../supabaseAdmin";

/**
 * Terminal removal of a timed-out preorder. Same outcome the spec asks for
 * regardless of reason:
 *   1. record a clean, PII-free stub in removed_signups (the durable fact),
 *   2. delete the Stripe Customer (which detaches/deletes the saved card),
 *   3. scrub PII (name / email / phone / birth year) from the consent_log +
 *      pending_signups rows and mark them 'removed'.
 *
 * We SCRUB rather than hard-DELETE the rows because pending_signups /consent_log
 * are referenced by RESTRICT foreign keys (teen_consent_id, referral_events,
 * consent_log.resend_of) — a delete would error on real data. The scrub leaves no
 * PII behind and the row is inert (status='removed'/consent_status='removed' is
 * matched by no pending/confirmed query). No resume path: to return, they sign up
 * fresh.
 */
export type RemovalReason = "no_response" | "payment_failed";

export async function removePreorderSignup(signupId: string, reason: RemovalReason): Promise<{ removed: boolean; detail?: string }> {
  const admin = getSupabaseAdmin();

  const { data: ps } = await admin
    .from("pending_signups")
    .select("id, created_at, status, stripe_customer_id, teen_consent_id, plus_one_consent_id")
    .eq("id", signupId)
    .maybeSingle();
  if (!ps) return { removed: false, detail: "not_found" };
  if (ps.status === "removed") return { removed: false, detail: "already_removed" };

  // 1) Clean stub FIRST so the fact survives even if a later step throws.
  await admin.from("removed_signups").insert({ created_at: ps.created_at, removed_at: new Date().toISOString(), reason });

  // 2) Delete the Stripe Customer (removes the saved payment method). Best-effort.
  if (ps.stripe_customer_id) {
    try {
      await getStripe().customers.del(ps.stripe_customer_id);
    } catch (e) {
      console.error(`[preorder-removal] stripe customer delete failed for ${ps.stripe_customer_id}:`, e instanceof Error ? e.message : e);
    }
  }

  // 3a) Scrub every consent row tied to this signup (individual links + family rows).
  const linkIds = [ps.teen_consent_id, ps.plus_one_consent_id].filter(Boolean) as string[];
  const { data: familyRows } = await admin.from("consent_log").select("id").eq("pending_signup_id", signupId);
  const consentIds = Array.from(new Set([...linkIds, ...((familyRows ?? []).map((r) => r.id as string))]));
  if (consentIds.length) {
    await admin
      .from("consent_log")
      .update({
        recipient_phone: "",          // NOT NULL — blank it (no digits => matches nothing)
        recipient_first_name: null,
        recipient_birth_year: null,
        recipient_country_code: null,
        consent_status: "removed",
      })
      .in("id", consentIds);
  }

  // 3b) Scrub the signup row itself and mark it removed.
  await admin
    .from("pending_signups")
    .update({
      purchaser_email: null,
      stripe_customer_id: null,
      stripe_payment_method_id: null,
      stripe_setup_intent_id: null,
      status: "removed",
    })
    .eq("id", signupId);

  return { removed: true };
}
