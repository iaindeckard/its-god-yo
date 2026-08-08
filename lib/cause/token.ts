import "server-only";
import crypto from "crypto";

/**
 * Tokenized, no-login access to the customer-facing cause-promotion status page —
 * the SAME HMAC pattern as the Cornerstone status link and the season-manage page
 * (IGY has no customer login, and we are deliberately not adding one). The token is
 * an HMAC over the Stripe customer id, so knowing a customer id reveals nothing
 * without the server secret, and a customer can only ever open their OWN page.
 *
 * Reuses the existing link-secret env chain (no new secret category required).
 */
const APP_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://itsgodyo.com").replace(/\/$/, "");
const secret = () =>
  process.env.CAUSE_LINK_SECRET ||
  process.env.SEASON_LINK_SECRET ||
  process.env.PREORDER_LINK_SECRET ||
  process.env.CRON_SECRET ||
  null;

export function causeStatusToken(customerId: string): string {
  const s = secret();
  if (!s) return "no-secret-set";
  return crypto.createHmac("sha256", s).update(`cause:${customerId}`).digest("hex").slice(0, 32);
}

export function verifyCauseStatusToken(customerId: string, token: string): boolean {
  const expected = causeStatusToken(customerId);
  if (expected === "no-secret-set") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(token || "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function causeStatusUrl(customerId: string): string {
  return `${APP_URL}/cause/status?c=${encodeURIComponent(customerId)}&t=${causeStatusToken(customerId)}`;
}
