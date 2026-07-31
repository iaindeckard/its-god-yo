import "server-only";
import crypto from "crypto";
import { phoneKey } from "./phone";

/**
 * Twilio helpers for the inbound SMS ("YES") handler. Delivery (outbound) lives
 * in the submit-consent Edge Function; this module is the Next.js side that
 * receives replies.
 */

/**
 * Validate an inbound Twilio webhook request. Twilio signs (URL + the POST params
 * sorted by key, concatenated key+value) with the account auth token, HMAC-SHA1,
 * base64. `url` MUST be the exact URL Twilio was configured to call (scheme, host,
 * path, and any query string) — mismatches produce a valid-looking 403.
 */
export function verifyTwilioSignature(
  authToken: string,
  signature: string | null,
  url: string,
  params: Record<string, string>,
): boolean {
  if (!authToken || !signature) return false;
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  const expected = crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Tolerant phone-matching key (digits-only, last-10). Kept under the historical
 *  `normalizePhone` name for back-compat; the single source of truth is
 *  `phoneKey` in lib/phone.ts. Use this ONLY for matching, never for storage —
 *  stored/sent numbers must be canonical E.164 (lib/phone.toE164). */
export const normalizePhone = phoneKey;

export type ReplyIntent = "confirm" | "stop" | "help" | "unknown";

/** Classify an inbound SMS body. Carrier/Twilio Advanced Opt-Out may intercept
 *  STOP/HELP before we ever see them; we still handle them defensively. */
export function classifyReply(body: string): ReplyIntent {
  const t = body.trim().toUpperCase().replace(/[.!¡¿?]/g, "");
  if (["YES", "Y", "YEAH", "YEP", "SI", "SÍ", "SI!", "START", "UNSTOP"].includes(t)) return "confirm";
  if (["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT", "NO"].includes(t)) return "stop";
  if (["HELP", "INFO", "AYUDA"].includes(t)) return "help";
  return "unknown";
}
