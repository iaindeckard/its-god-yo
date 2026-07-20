import Stripe from "stripe";

/** Server-only Stripe client. Uses the account's default API version (the
 *  account is pinned in the Stripe dashboard). Never import this from a client
 *  component — STRIPE_SECRET_KEY must never reach the browser. */
let _stripe: Stripe | null = null;
export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  _stripe = new Stripe(key);
  return _stripe;
}
