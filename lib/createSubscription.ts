import "server-only";
import type Stripe from "stripe";
import { getStripe } from "./stripe";
import { getSupabaseAdmin } from "./supabaseAdmin";
import { promoAttestationSatisfied, promoRequiredAddonsSatisfied } from "./promoCodes";
import { baseIntervalForPlanKey, dmPriceForBaseInterval } from "./plans";

/**
 * Deferred, consent-gated subscription creation — the linchpin of the
 * save-card-now / bill-later model. Called AFTER the recipient confirms by SMS
 * (today via the internal trigger route; later by the Twilio "YES" handler).
 * Creates an off_session subscription with a 7-day trial measured from NOW
 * (= the confirmation moment), using the card saved at signup as the default
 * payment method. Nothing is charged now (trial => $0 first invoice).
 *
 * Grounded in Stripe's documented pattern: SetupIntent(usage=off_session) at
 * signup -> create subscription later with default_payment_method + trial.
 */

export type CreateStatus =
  | "created"
  | "already_created"
  | "blocked_enhanced"
  | "not_found"
  | "not_ready"
  | "payment_failed";

export interface CreateResult {
  status: CreateStatus;
  subscription_id?: string;
  detail?: string;
}

export interface CreateOptions {
  /**
   * Preorder / activation path: charge the saved card NOW instead of starting a
   * 7-day trial. Creates the subscription with no trial + payment_behavior
   * 'error_if_incomplete', so Stripe attempts the first invoice synchronously and
   * a decline surfaces immediately as { status: "payment_failed" } (rather than a
   * webhook-only past_due days later). On success the row is marked 'active'.
   */
  chargeImmediately?: boolean;
}

export async function createSubscriptionForPendingSignup(pendingSignupId: string, opts: CreateOptions = {}): Promise<CreateResult> {
  const chargeNow = opts.chargeImmediately === true;
  const admin = getSupabaseAdmin();
  const stripe = getStripe();

  const { data: ps, error } = await admin.from("pending_signups").select("*").eq("id", pendingSignupId).single();
  if (error || !ps) return { status: "not_found" };
  if (ps.stripe_subscription_id) return { status: "already_created", subscription_id: ps.stripe_subscription_id };

  // Age-gate seam: NEVER activate a subscription for a recipient still pending
  // an enhanced consent mechanism (see the age-consent architecture).
  const consentIds = [ps.teen_consent_id, ps.plus_one_consent_id].filter(Boolean) as string[];
  if (consentIds.length) {
    const { data: consents } = await admin.from("consent_log").select("id, age_gate_decision").in("id", consentIds);
    if ((consents ?? []).some((c) => c.age_gate_decision === "enhanced_pending_mechanism")) {
      return { status: "blocked_enhanced", detail: "a recipient is pending an enhanced consent mechanism" };
    }
  }

  if (!ps.stripe_customer_id || !ps.stripe_payment_method_id) {
    return { status: "not_ready", detail: "missing stripe_customer_id or stripe_payment_method_id" };
  }

  // Family = flat (qty 1). Group bands = per-teen quantity.
  const isGroup = typeof ps.plan_key === "string" && ps.plan_key.startsWith("group_");
  const quantity = isGroup && ps.group_teen_count ? ps.group_teen_count : 1;

  const items: Stripe.SubscriptionCreateParams.Item[] = [{ price: ps.base_price_id, quantity }];
  // DM from Him is its own line item, priced per teen. This path is
  // individual/gift/group (family uses lib/familyBilling), so the DM quantity is
  // the SAME as the base quantity — group_teen_count for a group, 1 for
  // individual/gift. The add-on price MUST match the base plan's interval —
  // monthly base -> monthly add-on, annual base -> annual add-on — or Stripe
  // rejects the mixed interval.
  if (ps.dm_addon) {
    const dmPrice = dmPriceForBaseInterval(baseIntervalForPlanKey(ps.plan_key));
    items.push({ price: dmPrice, quantity });
  }

  // Promo codes still apply; the old 10%-off referral coupon was retired —
  // referrals now reward via a customer-balance credit at conversion (lib/referral.ts).
  const discounts: Stripe.SubscriptionCreateParams.Discount[] = [];
  if (ps.promo_promotion_code_id) {
    // Two independent policy gates, both must pass for the discount to apply:
    //  1. Affinity attestation — an attestation-required code is only honored when
    //     the signup recorded a confirmed attestation (spec: affinity codes).
    //  2. Required add-ons — a code that requires an add-on (e.g. DM from Him) only
    //     applies when that add-on is part of this purchase (lib/requiredAddons).
    const addonSelection = { dmAddon: !!ps.dm_addon };
    const [attestOk, addonsOk] = await Promise.all([
      promoAttestationSatisfied(ps.promo_promotion_code_id, ps.promo_attestation_confirmed),
      promoRequiredAddonsSatisfied(ps.promo_promotion_code_id, addonSelection),
    ]);
    if (attestOk && addonsOk) {
      discounts.push({ promotion_code: ps.promo_promotion_code_id });
    } else if (!attestOk) {
      console.warn(`[createSubscription] promo ${ps.promo_code} requires attestation but signup ${ps.id} has none — discount NOT applied`);
    } else {
      console.warn(`[createSubscription] promo ${ps.promo_code} requires an add-on not selected on signup ${ps.id} — discount NOT applied`);
    }
  }

  const baseParams: Stripe.SubscriptionCreateParams = {
    customer: ps.stripe_customer_id,
    items,
    default_payment_method: ps.stripe_payment_method_id,
    off_session: true,
    ...(discounts.length ? { discounts } : {}),
    metadata: {
      pending_signup_id: ps.id,
      teen_consent_id: ps.teen_consent_id ?? "",
      plan_key: ps.plan_key ?? "",
      // Church group enrollment attribution (Phase 1). Empty for organic signups.
      cornerstone_partner_id: ps.cornerstone_partner_id ?? "",
    },
  };

  if (chargeNow) {
    // Preorder activation: no trial, charge immediately, fail synchronously on a
    // decline. The idempotency key is scoped to the payment method so a retry with
    // a NEW card (see the tokenized retry page) starts a fresh attempt rather than
    // replaying the declined one; a duplicate YES on the SAME card is still deduped.
    let sub: Stripe.Subscription;
    try {
      sub = await stripe.subscriptions.create(
        { ...baseParams, payment_behavior: "error_if_incomplete" },
        { idempotencyKey: `igy_sub_${ps.id}_${ps.stripe_payment_method_id}` },
      );
    } catch (e) {
      const err = e as Stripe.errors.StripeError;
      if (err?.type === "StripeCardError" || err?.code === "card_declined" || err?.code === "expired_card" || err?.code === "incorrect_cvc" || err?.code === "processing_error" || err?.code === "insufficient_funds") {
        // Card declined — leave stripe_subscription_id null so a retry can start fresh.
        return { status: "payment_failed", detail: err.message || err.code || "card_declined" };
      }
      throw e; // unexpected (config/programming) error — surface it
    }
    if (sub.status !== "active") {
      return { status: "payment_failed", detail: `subscription_status_${sub.status}` };
    }
    await admin
      .from("pending_signups")
      .update({ stripe_subscription_id: sub.id, subscription_created_at: new Date().toISOString(), status: "active" })
      .eq("id", ps.id);
    if (consentIds.length) {
      // Also set the pending_signup back-reference so a later SMS STOP can always
      // resolve this subscription and cancel billing (see twilioInbound).
      await admin.from("consent_log").update({ consent_status: "confirmed", pending_signup_id: ps.id }).in("id", consentIds);
    }
    return { status: "created", subscription_id: sub.id };
  }

  // Normal path: off_session subscription with a 7-day trial (nothing charged now).
  const sub = await stripe.subscriptions.create(
    { ...baseParams, trial_period_days: 7 },
    { idempotencyKey: `igy_sub_${ps.id}` }, // retries never double-create
  );

  // Best-effort: capture the exact expected first charge (base + add-on, POST promo
  // discount) from Stripe's upcoming invoice, for POTENTIAL-revenue valuation in the
  // cause-promotion tracker. This is the only signal we store; REALIZED revenue is
  // always driven off actual settled payments, never this. Must NEVER block or fail
  // the signup — a null just means that trial contributes 0 to potential.
  let expectedFirstChargeCents: number | null = null;
  try {
    const upcoming = await stripe.invoices.retrieveUpcoming({ customer: ps.stripe_customer_id, subscription: sub.id });
    if (typeof upcoming?.total === "number") expectedFirstChargeCents = upcoming.total;
  } catch (e) {
    console.warn(`[createSubscription] expected_first_charge capture failed for ${ps.id}: ${e instanceof Error ? e.message : String(e)}`);
  }

  await admin
    .from("pending_signups")
    .update({ stripe_subscription_id: sub.id, subscription_created_at: new Date().toISOString(), status: "subscription_created", expected_first_charge_cents: expectedFirstChargeCents })
    .eq("id", ps.id);

  // The recipient(s) replied YES — move consent from pending to confirmed, and set
  // the pending_signup back-reference so a later SMS STOP can always resolve this
  // subscription and cancel billing (see twilioInbound).
  if (consentIds.length) {
    await admin.from("consent_log").update({ consent_status: "confirmed", pending_signup_id: ps.id }).in("id", consentIds);
  }

  return { status: "created", subscription_id: sub.id };
}
