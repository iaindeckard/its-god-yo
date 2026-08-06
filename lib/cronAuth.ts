import "server-only";
import crypto from "crypto";

/**
 * Authorize a Vercel Cron request. REQUIRES the CRON_SECRET bearer token — the
 * `x-vercel-cron` header is intentionally NOT accepted, because Vercel does not
 * strip it from inbound requests, so anyone who knows the endpoint URL could forge
 * it and trigger a cron (some of which send real SMS/email or touch billing).
 *
 * This does not break the scheduler: when CRON_SECRET is set, Vercel automatically
 * attaches `Authorization: Bearer ${CRON_SECRET}` to its scheduled invocations, so
 * the real cron runs pass while spoofed external calls are rejected.
 *
 * Fails closed — if CRON_SECRET is unset, every request is rejected (no cron should
 * run unauthenticated). Comparison is constant-time (matching lib/twilio's HMAC
 * check) so response timing can't be used to recover the secret.
 */
export function isAuthorizedCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}
