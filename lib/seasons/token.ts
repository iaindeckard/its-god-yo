import "server-only";
import crypto from "crypto";

/**
 * Tokenized, no-login access to the season-manage page — same HMAC pattern as the
 * preorder retry / Cornerstone status links (IGY has no customer login). The token is
 * an HMAC over the Stripe customer id, so knowing a customer id reveals nothing
 * without the server secret. Marketing links a subscriber to manage/add seasons.
 */
const APP_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://itsgodyo.com").replace(/\/$/, "");
const secret = () => process.env.SEASON_LINK_SECRET || process.env.PREORDER_LINK_SECRET || process.env.CRON_SECRET || null;

export function seasonManageToken(customerId: string): string {
  const s = secret();
  if (!s) return "no-secret-set";
  return crypto.createHmac("sha256", s).update(`season:${customerId}`).digest("hex").slice(0, 32);
}

export function verifySeasonManageToken(customerId: string, token: string): boolean {
  const expected = seasonManageToken(customerId);
  if (expected === "no-secret-set") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(token || "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function seasonManageUrl(customerId: string): string {
  return `${APP_URL}/seasons/manage?c=${encodeURIComponent(customerId)}&t=${seasonManageToken(customerId)}`;
}
