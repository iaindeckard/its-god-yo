import "server-only";
import crypto from "crypto";

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

/** Digits-only, last-10 (US/CA/MX national number) for tolerant phone matching
 *  between the as-typed number stored at signup and Twilio's E.164 `From`. */
export function normalizePhone(raw: string | null | undefined): string {
  const digits = (raw || "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

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
