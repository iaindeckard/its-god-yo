import Stripe from "stripe";

/** Server-only Stripe client. API version is PINNED (not left to the account
 *  default) so behavior can't drift when Stripe rolls the account forward.
 *  2025-02-24.acacia matches the installed stripe SDK's built-for version and is
 *  a version where BOTH the customer path (`discounts: [{coupon|promotion_code}]`
 *  on subscriptions) and the admin path (`promotionCodes.create({coupon})`) work
 *  — the newer default renamed coupon->promotion, which 400s promo-code creation.
 *  Never import this from a client component — STRIPE_SECRET_KEY must never reach
 *  the browser. */
const STRIPE_API_VERSION = "2025-02-24.acacia";
let _stripe: Stripe | null = null;
export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  _stripe = new Stripe(key, { apiVersion: STRIPE_API_VERSION });
  return _stripe;
}
