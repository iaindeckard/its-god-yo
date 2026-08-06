import "server-only";
import { getStripe } from "./stripe";
import { getSupabaseAdmin } from "./supabaseAdmin";

/**
 * Opt-out / STOP cancellation — the billing side of an SMS STOP. A confirmed,
 * active subscriber who texts STOP must have their Stripe subscription CANCELED
 * (not just their consent row flipped), otherwise billing continues after opt-out.
 *
 * All operations are idempotent: canceling an already-canceled / already-deleted
 * subscription is swallowed, and setting status='canceled' twice is harmless.
 */

/** True when a Stripe error is the benign "this subscription is already gone"
 *  case — canceling an already-canceled or nonexistent sub must not throw. */
function isAlreadyGone(e: unknown): boolean {
  const err = e as { code?: string; statusCode?: number; message?: string } | null;
  if (!err) return false;
  if (err.code === "resource_missing") return true;
  const msg = (err.message || "").toLowerCase();
  return (
    msg.includes("no such subscription") ||
    msg.includes("already been canceled") ||
    msg.includes("already canceled")
  );
}

/**
 * Cancel the Stripe subscription tied to a pending_signup (if any) and mark the
 * signup canceled. Safe to call when there is no subscription yet (pending STOP):
 * it just flips status to 'canceled'. Idempotent.
 */
export async function cancelSubscriptionForSignup(
  pendingSignupId: string,
  reason: string,
): Promise<{ canceled: boolean; subscription_id?: string }> {
  const admin = getSupabaseAdmin();

  const { data: ps } = await admin
    .from("pending_signups")
    .select("id, stripe_subscription_id, status")
    .eq("id", pendingSignupId)
    .maybeSingle();

  const subId: string | null = ps?.stripe_subscription_id ?? null;
  let canceled = false;

  if (subId) {
    const stripe = getStripe();
    try {
      await stripe.subscriptions.cancel(subId);
      canceled = true;
    } catch (e) {
      if (isAlreadyGone(e)) {
        canceled = true; // already gone == desired end state
      } else {
        throw e;
      }
    }
  }

  // Match the existing STOP path, which only writes status='canceled' (no
  // canceled_reason/canceled_at columns exist on pending_signups today). Keep the
  // reason in the log for audit rather than assuming a column.
  console.log(`[cancelSubscription] signup=${pendingSignupId} sub=${subId ?? "none"} reason=${reason}`);
  await admin.from("pending_signups").update({ status: "canceled" }).eq("id", pendingSignupId);

  return { canceled, subscription_id: subId ?? undefined };
}

/**
 * Cancel a Stripe subscription by id directly, with no pending_signups row to
 * update (e.g. a chargeback on a subscription we can't tie back to a local
 * signup). Idempotent: an already-canceled/nonexistent sub is treated as success.
 * The reason is logged for the audit trail (there is no canceled_reason column).
 */
export async function cancelStripeSubscriptionById(subId: string, reason: string): Promise<{ canceled: boolean }> {
  const stripe = getStripe();
  try {
    await stripe.subscriptions.cancel(subId);
  } catch (e) {
    if (!isAlreadyGone(e)) throw e;
  }
  console.log(`[cancelSubscription] direct sub=${subId} reason=${reason}`);
  return { canceled: true };
}

/**
 * Family teardown: cancel the whole base subscription ONLY when no teen can still
 * be (or become) an active recipient. Counts family_teen consent rows that are
 * either 'confirmed' (active) OR 'pending_confirmation' (invited, hasn't texted
 * YES yet — could still activate); if ZERO remain, cancel the base subscription.
 * (BUG-3 — a per-teen STOP must never cancel the family while siblings are still
 * active, but the LAST teen opting out should stop billing the base.)
 *
 * Including pending_confirmation is deliberate: canceling while a teen is still
 * pending would strand them — their later YES hits the already-created guard on
 * the now-canceled sub and they could never activate.
 */
export async function cancelFamilyBaseIfNoActiveTeens(pendingSignupId: string): Promise<boolean> {
  const admin = getSupabaseAdmin();

  const { count, error } = await admin
    .from("consent_log")
    .select("id", { count: "exact", head: true })
    .eq("pending_signup_id", pendingSignupId)
    .eq("consent_type", "family_teen")
    .in("consent_status", ["confirmed", "pending_confirmation"]);

  if (error) throw new Error(`family_active_count_failed: ${error.message}`);

  const activeOrPendingTeens = count ?? 0;
  if (activeOrPendingTeens > 0) return false;

  await cancelSubscriptionForSignup(pendingSignupId, "family_all_teens_opted_out");
  return true;
}
