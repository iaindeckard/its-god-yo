import "server-only";
import type Stripe from "stripe";
import { getStripe } from "./stripe";
import { getSupabaseAdmin } from "./supabaseAdmin";
import { promoAttestationSatisfied } from "./promoCodes";
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
  | "not_ready";

export interface CreateResult {
  status: CreateStatus;
  subscription_id?: string;
  detail?: string;
}

export async function createSubscriptionForPendingSignup(pendingSignupId: string): Promise<CreateResult> {
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
    // Affinity attestation gate: an attestation-required code is only honored
    // when the signup recorded a confirmed attestation (spec: affinity codes).
    if (await promoAttestationSatisfied(ps.promo_promotion_code_id, ps.promo_attestation_confirmed)) {
      discounts.push({ promotion_code: ps.promo_promotion_code_id });
    } else {
      console.warn(`[createSubscription] promo ${ps.promo_code} requires attestation but signup ${ps.id} has none — discount NOT applied`);
    }
  }

  const sub = await stripe.subscriptions.create(
    {
      customer: ps.stripe_customer_id,
      items,
      default_payment_method: ps.stripe_payment_method_id,
      trial_period_days: 7,
      off_session: true,
      ...(discounts.length ? { discounts } : {}),
      metadata: {
        pending_signup_id: ps.id,
        teen_consent_id: ps.teen_consent_id ?? "",
        plan_key: ps.plan_key ?? "",
      },
    },
    { idempotencyKey: `igy_sub_${ps.id}` }, // retries never double-create
  );

  await admin
    .from("pending_signups")
    .update({ stripe_subscription_id: sub.id, subscription_created_at: new Date().toISOString(), status: "subscription_created" })
    .eq("id", ps.id);

  // The recipient(s) replied YES — move consent from pending to confirmed.
  if (consentIds.length) {
    await admin.from("consent_log").update({ consent_status: "confirmed" }).in("id", consentIds);
  }

  return { status: "created", subscription_id: sub.id };
}
