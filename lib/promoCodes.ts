import "server-only";
import type Stripe from "stripe";
import { getStripe } from "./stripe";

/**
 * Stripe-native promo codes. We deliberately use Stripe's Coupon +
 * PromotionCode objects rather than custom discount math — Stripe already does
 * percentage-off, flat-amount-off, expiration, and max-redemptions correctly,
 * and it's what the (SetupIntent-based) checkout applies at real
 * subscription-creation time.
 *
 *   Coupon         -> the discount definition (percent_off OR amount_off, duration)
 *   PromotionCode  -> the customer-facing code + max_redemptions + expires_at
 *
 * Every field is per-code (locked decision): discount type, single-use vs
 * reusable (max_redemptions 1 vs unlimited), and optional expiry are all chosen
 * at creation. The friendly internal note lives in metadata.internal_note and
 * is never shown to customers.
 */
export interface PromoCodeView {
  id: string; // promotion_code id (promo_...)
  code: string; // customer-facing code
  active: boolean;
  times_redeemed: number;
  max_redemptions: number | null;
  expires_at: number | null;
  created: number;
  coupon_id: string;
  percent_off: number | null;
  amount_off: number | null; // cents
  currency: string | null;
  duration: string;
  duration_in_months: number | null;
  note: string | null;
}

function toView(pc: Stripe.PromotionCode): PromoCodeView {
  const c = pc.coupon;
  return {
    id: pc.id,
    code: pc.code,
    active: pc.active,
    times_redeemed: pc.times_redeemed,
    max_redemptions: pc.max_redemptions ?? null,
    expires_at: pc.expires_at ?? null,
    created: pc.created,
    coupon_id: c.id,
    percent_off: c.percent_off ?? null,
    amount_off: c.amount_off ?? null,
    currency: c.currency ?? null,
    duration: c.duration,
    duration_in_months: c.duration_in_months ?? null,
    note: pc.metadata?.internal_note || c.metadata?.internal_note || null,
  };
}

export async function listPromoCodes(): Promise<PromoCodeView[]> {
  const stripe = getStripe();
  const res = await stripe.promotionCodes.list({ limit: 100 });
  return res.data.map(toView);
}

export interface CreatePromoInput {
  code?: string;
  discountType: "percent" | "amount";
  value: number; // percent (1-100) or dollars
  currency?: string;
  duration?: "once" | "forever" | "repeating";
  durationInMonths?: number;
  maxRedemptions?: number | null; // null/omitted => unlimited
  expiresAt?: number | null; // unix seconds
  note?: string;
}

export async function createPromoCode(input: CreatePromoInput): Promise<PromoCodeView> {
  const stripe = getStripe();
  const duration = input.duration ?? "once";

  const couponParams: Stripe.CouponCreateParams = { duration };
  if (input.note) couponParams.metadata = { internal_note: input.note };
  if (duration === "repeating") couponParams.duration_in_months = input.durationInMonths ?? 3;
  if (input.discountType === "percent") {
    couponParams.percent_off = input.value;
  } else {
    couponParams.amount_off = Math.round(input.value * 100);
    couponParams.currency = (input.currency ?? "usd").toLowerCase();
  }
  const coupon = await stripe.coupons.create(couponParams);

  const pcParams: Stripe.PromotionCodeCreateParams = { coupon: coupon.id };
  if (input.code) pcParams.code = input.code;
  if (input.maxRedemptions && input.maxRedemptions > 0) pcParams.max_redemptions = input.maxRedemptions;
  if (input.expiresAt) pcParams.expires_at = input.expiresAt;
  if (input.note) pcParams.metadata = { internal_note: input.note };

  const pc = await stripe.promotionCodes.create(pcParams);
  return toView(pc);
}

/** Soft-disable (never hard-delete a used code — keeps reporting integrity). */
export async function deactivatePromoCode(id: string): Promise<PromoCodeView> {
  const stripe = getStripe();
  const pc = await stripe.promotionCodes.update(id, { active: false });
  return toView(pc);
}

/** Stripe codes are largely immutable; the editable surface is active + the
 *  internal note (metadata). Editing here updates the note. */
export async function updatePromoNote(id: string, note: string): Promise<PromoCodeView> {
  const stripe = getStripe();
  const pc = await stripe.promotionCodes.update(id, { metadata: { internal_note: note } });
  return toView(pc);
}

/** Validate a customer-entered code (used by the signup flow, Stage 2). Returns
 *  the active/usable promo code, or null if not found / inactive / exhausted. */
export async function findUsablePromoCode(code: string): Promise<PromoCodeView | null> {
  const stripe = getStripe();
  const res = await stripe.promotionCodes.list({ code, active: true, limit: 1 });
  const pc = res.data[0];
  if (!pc) return null;
  const view = toView(pc);
  if (view.max_redemptions != null && view.times_redeemed >= view.max_redemptions) return null;
  if (view.expires_at != null && view.expires_at * 1000 < Date.now()) return null;
  return view;
}
