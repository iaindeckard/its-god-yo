import "server-only";
import crypto from "crypto";
import { getSupabaseAdmin } from "../supabaseAdmin";
import { OUTREACH } from "./config";

export const OUTREACH_ATTR_COOKIE = "igy_outreach_attr";
export const OUTREACH_ATTR_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
export const OUTREACH_LINK_MAX_AGE = 60 * 60 * 24 * 45; // 45 days; touch 2 gets a fresh link

export type OutreachTouch = 1 | 2;
export type OutreachLanguage = "en" | "es";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function attributionSecret(): string | null {
  // Prefer a dedicated secret when configured. Existing server-only secrets are
  // safe fallbacks so attribution can be introduced without weakening the send
  // or unsubscribe gates.
  return process.env.OUTREACH_ATTRIBUTION_SECRET
    || process.env.OUTREACH_UNSUB_SECRET
    || process.env.CRON_SECRET
    || null;
}

function tokenMessage(
  leadId: string,
  touch: OutreachTouch,
  language: OutreachLanguage,
  expiresUnix: number,
): string {
  return `v1:${leadId}:${touch}:${language}:${expiresUnix}`;
}

export function outreachAttributionToken(
  leadId: string,
  touch: OutreachTouch,
  language: OutreachLanguage = "en",
  expiresUnix = Math.floor(Date.now() / 1000) + OUTREACH_LINK_MAX_AGE,
): string {
  const secret = attributionSecret();
  if (!secret) return "no-secret-set"; // dry-run only; verifier rejects it
  return crypto
    .createHmac("sha256", secret)
    .update(tokenMessage(leadId, touch, language, expiresUnix))
    .digest("hex")
    .slice(0, 40);
}

export function verifyOutreachAttributionToken(
  leadId: string,
  touch: OutreachTouch,
  language: OutreachLanguage,
  expiresUnix: number,
  token: string,
  nowUnix = Math.floor(Date.now() / 1000),
): boolean {
  if (!UUID_RE.test(leadId)) return false;
  if (!Number.isSafeInteger(expiresUnix) || expiresUnix <= nowUnix) return false;
  // Reject signatures with an implausibly distant expiry too. This makes the
  // maximum validity a server policy rather than something the URL can extend.
  if (expiresUnix > nowUnix + OUTREACH_LINK_MAX_AGE + 60) return false;
  const expected = outreachAttributionToken(leadId, touch, language, expiresUnix);
  if (expected === "no-secret-set") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(token || "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function outreachEntryUrl(
  leadId: string,
  touch: OutreachTouch,
  language: OutreachLanguage = "en",
): string {
  const expiresUnix = Math.floor(Date.now() / 1000) + OUTREACH_LINK_MAX_AGE;
  const url = new URL("/outreach/r", OUTREACH.appUrl);
  url.searchParams.set("lead", leadId);
  url.searchParams.set("touch", String(touch));
  url.searchParams.set("lang", language);
  url.searchParams.set("exp", String(expiresUnix));
  url.searchParams.set("t", outreachAttributionToken(leadId, touch, language, expiresUnix));
  return url.toString();
}

export function readOutreachAttributionCookie(raw: string | undefined | null): string | null {
  if (!raw || !UUID_RE.test(raw)) return null;
  return raw;
}

/**
 * Re-resolve the cookie server-side before signup trusts it. The cookie contains
 * only an opaque session UUID written by /outreach/r; the browser never supplies
 * lead/campaign identity directly.
 */
export async function resolveOutreachAttributionSession(sessionId: string | null): Promise<{
  id: string;
  leadId: string;
  campaignId: string;
  touch: OutreachTouch;
  language: OutreachLanguage;
} | null> {
  if (!sessionId || !UUID_RE.test(sessionId)) return null;
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("outreach_attribution_sessions")
    .select("id, lead_id, campaign_id, touch, language, expires_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (error || !data) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) return null;
  if ((data.touch !== 1 && data.touch !== 2) || (data.language !== "en" && data.language !== "es")) return null;
  return {
    id: data.id as string,
    leadId: data.lead_id as string,
    campaignId: data.campaign_id as string,
    touch: data.touch as OutreachTouch,
    language: data.language as OutreachLanguage,
  };
}
