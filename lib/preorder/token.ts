import "server-only";
import crypto from "crypto";

/**
 * Tokenized, no-login access for the payment-retry page — the exact pattern used
 * by the Cornerstone church status link and the teen /welcome link (IGY has no
 * customer login). The token is an HMAC over the signup's RANDOM UUID
 * (pending_signups.id), so knowing an id tells an attacker nothing without the
 * server secret.
 *
 * No expiry is baked into the token (like Cornerstone): access dies naturally
 * because the retry endpoint only acts on rows still in status='payment_failed'
 * — once the charge succeeds (-> active) or the row times out (-> removed), the
 * link stops doing anything.
 */
const APP_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://itsgodyo.com").replace(/\/$/, "");

function linkSecret(): string | null {
  return process.env.PREORDER_LINK_SECRET || process.env.CRON_SECRET || null;
}

export function retryAccessToken(signupId: string): string {
  const secret = linkSecret();
  if (!secret) return "no-secret-set"; // local/dev without secrets
  return crypto.createHmac("sha256", secret).update(signupId).digest("hex").slice(0, 32);
}

export function verifyRetryAccessToken(signupId: string, token: string): boolean {
  const expected = retryAccessToken(signupId);
  if (expected === "no-secret-set") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(token || "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function retryUrl(signupId: string): string {
  return `${APP_URL}/preorder/retry?ps=${encodeURIComponent(signupId)}&t=${retryAccessToken(signupId)}`;
}
