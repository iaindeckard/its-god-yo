import "server-only";

/**
 * Church-outreach agent — shared config + the send gate.
 * Spec: IGY-Church-Outreach-Agent-Spec-v1-READY-CORRECTED.md.
 *
 * SENDING IDENTITY (Iain, 2026-07-27): send as hello@outreach.itsgodyo.com (a
 * dedicated subdomain, so cold-outreach reputation is isolated from the root
 * product domain), Reply-To to Iain's Gmail (he reads every reply personally,
 * §7.4). Provider is Resend, reusing the RESEND_API_KEY already used by
 * lib/sponsorInquiry.ts — no second email vendor.
 */

export const OUTREACH = {
  from: process.env.OUTREACH_FROM || "It's God, Yo <hello@outreach.itsgodyo.com>",
  replyTo: process.env.OUTREACH_REPLY_TO || "iaindeckard@gmail.com",
  // Where the one-click unsubscribe route lives (this Next app). The From
  // *domain* is outreach.itsgodyo.com, but the unsub link just needs to be an
  // https URL we control and serve.
  appUrl: (process.env.OUTREACH_APP_URL || "https://itsgodyo.com").replace(/\/$/, ""),
  // Legally-required physical address in every commercial email (§2). Pulled
  // from IGY's own ToS/privacy footer — keep in sync with those pages.
  physicalAddress: "Deckard Enterprise International, LLC · 2221 N Amarado St, Wichita, KS 67205",
  // §7.3 — a lead that's been sent to this many times without converting ages out.
  ageOutSends: 6,
  promoPrefix: process.env.OUTREACH_PROMO_PREFIX || "IGY",
  // Discovery (§4)
  discoveryModel: process.env.OUTREACH_DISCOVERY_MODEL || "claude-sonnet-5",
  geography: process.env.OUTREACH_GEOGRAPHY || "the Wichita, Kansas metro area",
  discoveryTarget: Number(process.env.OUTREACH_DISCOVERY_TARGET_COUNT || 15),
} as const;

/**
 * THE SEND GATE — the hard requirement Iain set (2026-07-27): "nothing goes out
 * to a real organization until I explicitly sign off on BOTH the email copy AND
 * the legal review, separate from this build step."
 *
 * A live send is only possible when ALL THREE flags are explicitly "true":
 *   OUTREACH_COPY_APPROVED   — Iain has approved the drafted email copy
 *   OUTREACH_LEGAL_APPROVED  — the legal review has cleared
 *   OUTREACH_SEND_LIVE       — the master switch to actually send
 *
 * With any flag unset (the default), the send job runs in DRY-RUN mode: it
 * computes exactly who WOULD receive mail and renders each email, but mints no
 * promo codes and calls no email provider. There is deliberately NO way to force
 * a live send via request parameter — only these server-side env flags flip it.
 */
export function sendGate(): { live: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (process.env.OUTREACH_COPY_APPROVED !== "true") reasons.push("OUTREACH_COPY_APPROVED not set");
  if (process.env.OUTREACH_LEGAL_APPROVED !== "true") reasons.push("OUTREACH_LEGAL_APPROVED not set");
  if (process.env.OUTREACH_SEND_LIVE !== "true") reasons.push("OUTREACH_SEND_LIVE not set");
  return { live: reasons.length === 0, reasons };
}

/**
 * Optional belt-and-suspenders for the FIRST controlled live batch: if
 * OUTREACH_SEND_ALLOWLIST is set (comma-separated emails), a live send targets
 * ONLY those addresses. Empty/unset => no allowlist restriction.
 */
export function sendAllowlist(): Set<string> | null {
  const raw = process.env.OUTREACH_SEND_ALLOWLIST?.trim();
  if (!raw) return null;
  return new Set(
    raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  );
}

/** Prefixes we accept as a genuine general/office address. A departmental inbox
 *  like socialmedia@ is NOT here on purpose — such leads drop to needs_review
 *  (the Central Christian case, per Iain 2026-07-27). */
export const GENERAL_EMAIL_PREFIXES = [
  "info", "office", "church", "admin", "contact", "hello", "mail",
  "parish", "welcome", "connect", "reception", "frontdesk", "secretary",
];

export function isGeneralAddress(email: string): boolean {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  return GENERAL_EMAIL_PREFIXES.some((p) => local === p || local.startsWith(p + "."));
}
