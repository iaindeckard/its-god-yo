import "server-only";
import type Stripe from "stripe";
import { getStripe } from "./stripe";
import { TIER_KEYS, tierForPlanKey } from "./tiers";
import {
  type AddonSelection,
  parseRequiredAddons,
  REQUIRED_ADDON_IDS,
  unmetRequiredAddons,
} from "./requiredAddons";

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
 * Anything Stripe has no native field for (an internal label, the attestation
 * requirement + its exact text, a start date, a per-customer cap, and which
 * plan tiers a code applies to) is carried in metadata and enforced by the app
 * at validation time. Stripe stays the source of truth for the discount math
 * itself; metadata carries the policy around it. Metadata is written to BOTH
 * the coupon and the promotion code so either object read alone is complete.
 */
export interface PromoCodeView {
  id: string; // promotion_code id (promo_...)
  code: string; // customer-facing code
  active: boolean;
  times_redeemed: number;
  max_redemptions: number | null;
  expires_at: number | null; // unix seconds (Stripe-native end / redeem-by)
  created: number;
  coupon_id: string;
  percent_off: number | null;
  amount_off: number | null; // cents
  currency: string | null;
  duration: string;
  duration_in_months: number | null;
  // metadata-carried policy
  internal_label: string | null;
  note: string | null;
  max_per_customer: number | null;
  first_time_only: boolean; // Stripe restrictions.first_time_transaction
  requires_attestation: boolean;
  attestation_text: string | null;
  starts_at: number | null; // unix seconds — app-enforced (Stripe has no coupon start)
  allowed_tiers: string[]; // empty => applies to every tier
  required_addons: string[]; // add-on ids that must be selected to redeem (empty => none); see lib/requiredAddons
}

function parseTiers(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => TIER_KEYS.includes(s));
}

function toView(pc: Stripe.PromotionCode): PromoCodeView {
  const c = pc.coupon;
  const m = { ...(c.metadata ?? {}), ...(pc.metadata ?? {}) }; // pc wins on conflict
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
    internal_label: m.internal_label || null,
    note: m.internal_note || null,
    max_per_customer: m.max_per_customer ? Number(m.max_per_customer) : null,
    first_time_only: pc.restrictions?.first_time_transaction ?? false,
    requires_attestation: m.requires_attestation === "true",
    attestation_text: m.attestation_text || null,
    starts_at: m.starts_at ? Number(m.starts_at) : null,
    allowed_tiers: parseTiers(m.allowed_tiers),
    required_addons: parseRequiredAddons(m.required_addons),
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
  expiresAt?: number | null; // unix seconds (Stripe end / redeem-by)
  // metadata-carried policy
  internalLabel?: string;
  note?: string;
  maxPerCustomer?: number | null;
  firstTimeOnly?: boolean;
  requiresAttestation?: boolean;
  attestationText?: string;
  startsAt?: number | null; // unix seconds — app-enforced start
  allowedTiers?: string[]; // empty/omitted => all tiers
  requiredAddons?: string[]; // add-on ids that must be selected to redeem; empty/omitted => none
}

/** Build the metadata bag shared by the coupon and the promotion code. */
function buildMetadata(input: CreatePromoInput): Stripe.MetadataParam {
  const meta: Stripe.MetadataParam = {};
  if (input.internalLabel) meta.internal_label = input.internalLabel;
  if (input.note) meta.internal_note = input.note;
  if (input.maxPerCustomer != null) meta.max_per_customer = String(input.maxPerCustomer);
  if (input.requiresAttestation) {
    meta.requires_attestation = "true";
    if (input.attestationText) meta.attestation_text = input.attestationText;
  }
  if (input.startsAt) meta.starts_at = String(input.startsAt);
  const tiers = (input.allowedTiers ?? []).filter((t) => TIER_KEYS.includes(t));
  if (tiers.length) meta.allowed_tiers = tiers.join(",");
  const addons = (input.requiredAddons ?? []).filter((a) => REQUIRED_ADDON_IDS.includes(a));
  if (addons.length) meta.required_addons = addons.join(",");
  return meta;
}

export async function createPromoCode(input: CreatePromoInput): Promise<PromoCodeView> {
  const stripe = getStripe();
  const duration = input.duration ?? "once";
  const metadata = buildMetadata(input);

  const couponParams: Stripe.CouponCreateParams = { duration, metadata };
  if (duration === "repeating") couponParams.duration_in_months = input.durationInMonths ?? 3;
  if (input.discountType === "percent") {
    couponParams.percent_off = input.value;
  } else {
    couponParams.amount_off = Math.round(input.value * 100);
    couponParams.currency = (input.currency ?? "usd").toLowerCase();
  }
  const coupon = await stripe.coupons.create(couponParams);

  const pcParams: Stripe.PromotionCodeCreateParams = { coupon: coupon.id, metadata };
  if (input.code) pcParams.code = input.code;
  if (input.maxRedemptions && input.maxRedemptions > 0) pcParams.max_redemptions = input.maxRedemptions;
  if (input.expiresAt) pcParams.expires_at = input.expiresAt;
  // Stripe has no per-customer redemption cap; "first-time customers only" is the
  // closest native primitive and is what one-time-per-customer signup codes want.
  if (input.firstTimeOnly) pcParams.restrictions = { first_time_transaction: true };

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
 *  metadata (internal label / note). */
export async function updatePromoMeta(
  id: string,
  fields: { label?: string; note?: string },
): Promise<PromoCodeView> {
  const stripe = getStripe();
  const metadata: Stripe.MetadataParam = {};
  if (fields.label !== undefined) metadata.internal_label = fields.label;
  if (fields.note !== undefined) metadata.internal_note = fields.note;
  const pc = await stripe.promotionCodes.update(id, { metadata });
  return toView(pc);
}

/** Retrieve a single promotion code by its id (promo_...) as a view, or null if
 *  it can't be fetched. The coupon is always included on a promotion code, so
 *  toView() has everything it needs (incl. the attestation metadata). */
export async function getPromoViewById(id: string): Promise<PromoCodeView | null> {
  const stripe = getStripe();
  try {
    const pc = await stripe.promotionCodes.retrieve(id);
    return toView(pc);
  } catch {
    return null;
  }
}

/**
 * Affinity attestation gate (spec: IGY-Affinity-Promo-Codes-LOCKED-2026-07-21.md).
 * The authoritative server-side check, applied at subscription-creation time in
 * lib/createSubscription.ts + lib/familyBilling.ts: an attestation-required promo
 * discount is only applied when the signup recorded a confirmed attestation.
 *
 * Returns true (apply the discount) UNLESS we can positively confirm the code
 * requires attestation AND it wasn't confirmed. Codes that don't require
 * attestation (e.g. the church-outreach 10% codes) always pass; a transient
 * Stripe read failure fails OPEN for the discount (the gate is a policy control,
 * not a security boundary — silently dropping a legitimate discount on a blip is
 * the worse failure).
 */
export async function promoAttestationSatisfied(
  promotionCodeId: string | null | undefined,
  attestationConfirmed: boolean | null | undefined,
): Promise<boolean> {
  if (!promotionCodeId) return false; // nothing to apply
  const view = await getPromoViewById(promotionCodeId);
  if (view?.requires_attestation && !attestationConfirmed) return false;
  return true;
}

/**
 * Required-add-on gate (general, registry-driven — lib/requiredAddons). The
 * authoritative server-side check, applied at subscription-creation time in
 * lib/createSubscription.ts + lib/familyBilling.ts alongside the attestation gate:
 * a code that requires an add-on (e.g. DM from Him) only keeps its discount when
 * that add-on is actually part of the purchase.
 *
 * Returns true (apply the discount) UNLESS we can positively confirm the code
 * requires an add-on that the selection is missing. Codes with no required add-ons
 * always pass (no regression to existing codes); a transient Stripe read failure
 * fails OPEN for the discount — same posture as the attestation gate (a policy
 * control, not a security boundary; silently dropping a legitimate discount on a
 * blip is the worse failure). The client-side validator prevents a customer from
 * reaching checkout in the unmet state; this is the fail-closed backstop.
 */
export async function promoRequiredAddonsSatisfied(
  promotionCodeId: string | null | undefined,
  selection: AddonSelection,
): Promise<boolean> {
  if (!promotionCodeId) return false; // nothing to apply
  const view = await getPromoViewById(promotionCodeId);
  if (!view) return true; // read blip → fail open (parity with attestation)
  return unmetRequiredAddons(view.required_addons, selection).length === 0;
}

/** True if a code with these allowed tiers applies to the given checkout plan. */
export function promoAppliesToTier(view: PromoCodeView, planKey: string | null | undefined): boolean {
  if (view.allowed_tiers.length === 0) return true; // unrestricted
  const tier = tierForPlanKey(planKey);
  return tier != null && view.allowed_tiers.includes(tier);
}

/**
 * Validate a customer-entered code (used by the signup flow, Stage 2). Returns
 * the active/usable promo code, or null if not found / inactive / exhausted /
 * not yet started / not applicable to the selected plan tier. `planKey` is the
 * checkout plan the customer is buying — pass it so tier restrictions and the
 * start date are actually enforced, not just displayed.
 */
export async function findUsablePromoCode(
  code: string,
  planKey?: string | null,
): Promise<PromoCodeView | null> {
  const stripe = getStripe();
  const res = await stripe.promotionCodes.list({ code, active: true, limit: 1 });
  const pc = res.data[0];
  if (!pc) return null;
  const view = toView(pc);
  const nowSec = Math.floor(Date.now() / 1000);
  if (view.max_redemptions != null && view.times_redeemed >= view.max_redemptions) return null;
  if (view.expires_at != null && view.expires_at < nowSec) return null;
  if (view.starts_at != null && view.starts_at > nowSec) return null; // not started yet
  if (planKey !== undefined && !promoAppliesToTier(view, planKey)) return null;
  return view;
}
