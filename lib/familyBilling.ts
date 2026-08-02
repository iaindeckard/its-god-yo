import "server-only";
import type Stripe from "stripe";
import { getStripe } from "./stripe";
import { getSupabaseAdmin } from "./supabaseAdmin";
import { PLANS, FAMILY_EXTRA_TEEN, FAMILY_BASE_TEENS } from "./plans";
import { promoAttestationSatisfied } from "./promoCodes";
import { reconcileDmAddon } from "./dmAddon";

/**
 * Family multi-teen billing. Model (all decisions locked 2026-07-21, verified via
 * Stripe test clock):
 *  - Base $99/yr Family price covers up to FAMILY_BASE_TEENS confirmed teens.
 *    The base subscription is created (deferred) when the FIRST teen replies YES,
 *    with a 7-day trial from that moment.
 *  - Each ADDITIONAL confirmed teen (beyond the base 2) is $28/yr, added to the
 *    extra-teen line item at THAT teen's own trial-end (confirm + 7d), prorated
 *    for the remaining annual cycle. Unconfirmed teens are billed $0.
 *  - The extra-teen quantity is reconciled idempotently: it always equals
 *    max(0, (confirmed teens whose 7-day trial has elapsed) - FAMILY_BASE_TEENS).
 */

const TRIAL_DAYS = 7;

/** Create the base Family subscription (base price only, 7-day trial). Called
 *  once, when the first teen on a Family purchase confirms. Idempotent. */
export async function createFamilyBaseSubscription(pendingSignupId: string): Promise<{ status: string; subscription_id?: string }> {
  const admin = getSupabaseAdmin();
  const stripe = getStripe();

  const { data: ps } = await admin.from("pending_signups").select("*").eq("id", pendingSignupId).single();
  if (!ps) return { status: "not_found" };
  if (ps.stripe_subscription_id) return { status: "already_created", subscription_id: ps.stripe_subscription_id };
  if (!ps.stripe_customer_id || !ps.stripe_payment_method_id) return { status: "not_ready" };

  // Promo codes still apply; the old 10%-off referral coupon was retired —
  // referrals now reward via a customer-balance credit at conversion (lib/referral.ts).
  const discounts: Stripe.SubscriptionCreateParams.Discount[] = [];
  if (ps.promo_promotion_code_id) {
    // Affinity attestation gate — same rule as lib/createSubscription.ts.
    if (await promoAttestationSatisfied(ps.promo_promotion_code_id, ps.promo_attestation_confirmed)) {
      discounts.push({ promotion_code: ps.promo_promotion_code_id });
    } else {
      console.warn(`[familyBilling] promo ${ps.promo_code} requires attestation but signup ${ps.id} has none — discount NOT applied`);
    }
  }

  const sub = await stripe.subscriptions.create(
    {
      customer: ps.stripe_customer_id,
      items: [{ price: ps.base_price_id ?? PLANS.family_annual.price_id!, quantity: 1 }],
      default_payment_method: ps.stripe_payment_method_id,
      trial_period_days: TRIAL_DAYS, // this (first) teen's 7-day trial
      off_session: true,
      ...(discounts.length ? { discounts } : {}),
      metadata: { pending_signup_id: ps.id, plan_key: "family" },
    },
    { idempotencyKey: `igy_family_${ps.id}` },
  );

  await admin
    .from("pending_signups")
    .update({ stripe_subscription_id: sub.id, subscription_created_at: new Date().toISOString(), status: "subscription_created" })
    .eq("id", ps.id);

  return { status: "created", subscription_id: sub.id };
}

/**
 * Reconcile the extra-teen quantity for one Family purchase. Idempotent — safe to
 * call on every teen confirmation AND on the scheduled trial-end job. Sets the
 * extra-teen line quantity to max(0, billableConfirmedTeens - FAMILY_BASE_TEENS),
 * where "billable" = confirmed AND past their 7-day trial. An increase is invoiced
 * immediately (prorated for the remaining cycle); a decrease/removal issues NO
 * credit for unused capacity already paid (parity with DM from Him's no-refund
 * policy, greenlit 2026-08-01).
 */
export async function reconcileFamilyExtraTeens(pendingSignupId: string): Promise<{ target: number; changed: boolean }> {
  const admin = getSupabaseAdmin();
  const stripe = getStripe();

  const { data: ps } = await admin
    .from("pending_signups")
    .select("id, stripe_subscription_id")
    .eq("id", pendingSignupId)
    .single();
  if (!ps?.stripe_subscription_id) return { target: 0, changed: false };

  // The base $99 covers the first FAMILY_BASE_TEENS *confirmed* teens (by
  // confirmation order). Everyone after that is an "extra" whose $28 is billed
  // once THEIR own 7-day trial has elapsed. So: rank confirmed teens by
  // confirmation time, drop the base slots, and count how many of the remaining
  // extras are past their trial. (A base teen still in their own trial must NOT
  // shrink the extra count — that's why we rank instead of subtracting.)
  const { data: confirmed } = await admin
    .from("consent_log")
    .select("id, confirmation_reply_at, trial_ends_at")
    .eq("pending_signup_id", pendingSignupId)
    .eq("consent_type", "family_teen")
    .eq("consent_status", "confirmed")
    .order("confirmation_reply_at", { ascending: true });

  const extras = (confirmed ?? []).slice(FAMILY_BASE_TEENS);
  const now = Date.now();
  const target = extras.filter((t) => t.trial_ends_at && new Date(t.trial_ends_at as string).getTime() <= now).length;

  const sub = await stripe.subscriptions.retrieve(ps.stripe_subscription_id);
  const extraItem = sub.items.data.find((i) => i.price.id === FAMILY_EXTRA_TEEN.price_id);
  const current = extraItem?.quantity ?? 0;
  if (target === current) {
    // Extra-teen count unchanged, but a teen's trial elapsing or an opt-out can
    // still change the DM billable count — keep the DM quantity in sync too.
    await syncDm(pendingSignupId);
    return { target, changed: false };
  }

  // Direction-aware proration (greenlit 2026-08-01, for parity with DM from Him's
  // no-refund policy): a teen being ADDED charges the prorated amount now
  // (always_invoice); a teen being REMOVED issues NO credit for the unused
  // capacity already paid (proration_behavior 'none').
  if (!extraItem) {
    if (target > 0) {
      // First extra teen(s) → charge the prorated amount now.
      await stripe.subscriptionItems.create({
        subscription: sub.id,
        price: FAMILY_EXTRA_TEEN.price_id,
        quantity: target,
        proration_behavior: "always_invoice",
      });
    }
  } else if (target > current) {
    // More extra teens → charge the prorated increase now.
    await stripe.subscriptionItems.update(extraItem.id, { quantity: target, proration_behavior: "always_invoice" });
  } else if (target > 0) {
    // Fewer extra teens (a teen removed) → NO credit for unused capacity.
    await stripe.subscriptionItems.update(extraItem.id, { quantity: target, proration_behavior: "none" });
  } else {
    // Down to zero extras → remove the line, NO credit.
    await stripe.subscriptionItems.del(extraItem.id, { proration_behavior: "none" });
  }

  // DM from Him quantity tracks the family's teen count (when DM is on). Hooked
  // into the SAME add/remove flow rather than a separate mechanism. Best-effort —
  // a DM sync failure must never break the core extra-teen billing.
  await syncDm(pendingSignupId);
  return { target, changed: true };
}

/** Best-effort DM add-on quantity sync (never throws into the extra-teen path). */
async function syncDm(pendingSignupId: string): Promise<void> {
  try {
    await reconcileDmAddon(pendingSignupId);
  } catch (e) {
    console.error("[familyBilling] DM reconcile failed", pendingSignupId, e instanceof Error ? e.message : e);
  }
}

/** Cron entry point: reconcile every active Family purchase (picks up teens
 *  whose 7-day trial has just elapsed). Returns per-signup results. */
export async function reconcileAllFamilies(): Promise<Array<{ id: string; target: number; changed: boolean }>> {
  const admin = getSupabaseAdmin();
  const { data: families } = await admin
    .from("pending_signups")
    .select("id")
    .eq("plan_key", "family")
    .not("stripe_subscription_id", "is", null);
  const out: Array<{ id: string; target: number; changed: boolean }> = [];
  for (const f of families ?? []) {
    try {
      out.push({ id: f.id, ...(await reconcileFamilyExtraTeens(f.id)) });
    } catch (e) {
      out.push({ id: f.id, target: -1, changed: false });
      console.error("[family reconcile] failed", f.id, e instanceof Error ? e.message : e);
    }
  }
  return out;
}
