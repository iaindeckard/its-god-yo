import "server-only";
import type Stripe from "stripe";
import { getStripe } from "./stripe";
import { getSupabaseAdmin } from "./supabaseAdmin";

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

// Standing 10%-off referral coupon, ensured lazily (one coupon reused for all
// referrals — NOT one per signup).
const REFERRAL_COUPON_ID = "igy_referral_10";

async function ensureReferralCoupon(stripe: Stripe): Promise<string> {
  try {
    await stripe.coupons.retrieve(REFERRAL_COUPON_ID);
  } catch {
    await stripe.coupons.create({
      id: REFERRAL_COUPON_ID,
      percent_off: 10,
      duration: "forever",
      name: "Referral 10% off",
      metadata: { source: "itsgodyo_referral" },
    });
  }
  return REFERRAL_COUPON_ID;
}

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
  // The "DM from Him" +1 is ALWAYS its own monthly item, independent of the
  // base plan's cadence.
  if (ps.dm_addon && ps.dm_addon_price_id) items.push({ price: ps.dm_addon_price_id });

  const discounts: Stripe.SubscriptionCreateParams.Discount[] = [];
  if (ps.promo_promotion_code_id) discounts.push({ promotion_code: ps.promo_promotion_code_id });
  if (ps.referral_discount_applied) discounts.push({ coupon: await ensureReferralCoupon(stripe) });

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
