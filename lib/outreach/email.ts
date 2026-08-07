import "server-only";
import crypto from "crypto";
import { OUTREACH } from "./config";
import { SPANISH_ENABLED } from "../flags";
import type { OutreachLead } from "./leads";
import { resolveVariant, clampDiscountPercent, type MessageVariant } from "./templates";

/**
 * One-click unsubscribe token. HMAC over the lead id so the public unsubscribe
 * link can't be forged or enumerated. Secret: OUTREACH_UNSUB_SECRET, falling
 * back to CRON_SECRET (already a server secret in this project).
 */
function unsubSecret(): string | null {
  return process.env.OUTREACH_UNSUB_SECRET || process.env.CRON_SECRET || null;
}

export function unsubToken(leadId: string): string {
  const secret = unsubSecret();
  if (!secret) return "no-secret-set"; // only reachable in dry-run without secrets
  return crypto.createHmac("sha256", secret).update(leadId).digest("hex").slice(0, 32);
}

export function verifyUnsubToken(leadId: string, token: string): boolean {
  const expected = unsubToken(leadId);
  if (expected === "no-secret-set") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(token || "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function unsubUrl(leadId: string): string {
  return `${OUTREACH.appUrl}/api/outreach/unsubscribe?lead=${encodeURIComponent(leadId)}&t=${unsubToken(leadId)}`;
}

export interface BuiltEmail {
  to: string;
  from: string;
  replyTo: string;
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

function sourceNote(lead: OutreachLead): string {
  const first = Array.isArray(lead.source_urls) ? lead.source_urls[0] : null;
  return first ? String(first).replace(/^https?:\/\//, "").replace(/\s*\(.*$/, "") : "a public listing of your ministry";
}

/**
 * Build the compliant outreach email (spec §2). The copy here is the LOCKED /
 * APPROVED version (Iain, 2026-07-28 — IGY-Church-Outreach-Email-Copy-APPROVED-
 * 2026-07-28.md). Approval of the copy does NOT open the send gate: mail still
 * goes nowhere until OUTREACH_LEGAL_APPROVED + OUTREACH_SEND_LIVE are also set
 * (see config.sendGate). Every send carries: honest From/Subject,
 * one-click List-Unsubscribe (RFC 8058) + a visible link, the required physical
 * mailing address, and Reply-To to a monitored human inbox.
 */
export function buildEmail(lead: OutreachLead, variant: MessageVariant = "default"): BuiltEmail {
  // Guardrail: only an approved variant KEY is honored; copy is code-resident.
  // The intro (email 1) is code-free and identical across the sole 'default'
  // variant today — when a second approved variant ships, branch on `v` here.
  const v = resolveVariant(variant); void v;
  const org = lead.org_name;
  const link = unsubUrl(lead.id);
  const site = OUTREACH.appUrl;

  const subject = `A partnership opportunity for ${org}'s youth ministry`;

  const text =
`Hi ${org} team,

I'm Iain, founder of It's God, Yo!, a daily Scripture text devotional built for teens, ${SPANISH_ENABLED ? "in English (KJV) and Spanish (Reina-Valera 1909)" : "in English (KJV)"}. One verse a day, rewritten in their language, real slang they use today so they actually understand it. There's always a link back to the full KJV text too. And thanks to a proprietary system, the slang is never stale.

${org} has an active youth ministry, and I thought this might be useful for the students you're already working with. You can see how it works and sign up at ${site}.

No pressure here. Share it if it's a fit, ignore it if it's not. If you'd rather not hear from us again, the link below removes ${org} for good.

Thanks for helping us get the Word of God to young people every day.

Iain Deckard · It's God, Yo!
Reply to this email directly, it comes to me.

---
It's God, Yo!™ is operated by ${OUTREACH.physicalAddress}.
You received this because ${org} is a Wichita-area church with a publicly listed youth ministry. We're proud to say we're local too. We found your general contact address at ${sourceNote(lead)}. Please, help support a local small business!
Unsubscribe (one click): ${link}`;

  const html =
`<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1a1a1a;max-width:600px;margin:0 auto;">
  <p>Hi ${esc(org)} team,</p>
  <p>I'm Iain, founder of <strong>It's God, Yo!</strong>, a daily Scripture text devotional built for teens, ${SPANISH_ENABLED ? "in English (KJV) and Spanish (Reina-Valera 1909)" : "in English (KJV)"}. One verse a day, rewritten in their language, real slang they use today so they actually understand it. There's always a link back to the full KJV text too. And thanks to a proprietary system, the slang is never stale.</p>
  <p>${esc(org)} has an active youth ministry, and I thought this might be useful for the students you're already working with. You can see how it works and sign up at <a href="${site}" style="color:#00ABBC;">${esc(site.replace(/^https?:\/\//, ""))}</a>.</p>
  <p>No pressure here. Share it if it's a fit, ignore it if it's not. If you'd rather not hear from us again, the link below removes ${esc(org)} for good.</p>
  <p style="margin-bottom:2px;">Thanks for helping us get the Word of God to young people every day.</p>
  <p style="margin-bottom:2px;"><strong>Iain Deckard</strong> · It's God, Yo!</p>
  <p style="color:#555;">Reply to this email directly, it comes to me.</p>
  <hr style="border:none;border-top:1px solid #e2e2e2;margin:22px 0;"/>
  <p style="font-size:12px;color:#777;">
    It's God, Yo!™ is operated by ${esc(OUTREACH.physicalAddress)}.<br/>
    You received this because ${esc(org)} is a Wichita-area church with a publicly listed youth ministry. We're proud to say we're local too. We found your general contact address at ${esc(sourceNote(lead))}. Please, help support a local small business!<br/>
    <a href="${link}" style="color:#777;">Unsubscribe (one click)</a>
  </p>
</div>`;

  // RFC 8058: List-Unsubscribe with an https one-click endpoint + a mailto
  // fallback; List-Unsubscribe-Post signals one-click POST support.
  const headers: Record<string, string> = {
    "List-Unsubscribe": `<${link}>, <mailto:unsubscribe@outreach.itsgodyo.com?subject=unsub-${lead.id}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };

  return { to: lead.contact_email, from: OUTREACH.from, replyTo: OUTREACH.replyTo, subject, text, html, headers };
}

/**
 * The second-touch (email 2) follow-up: a light variant of buildEmail with a
 * "circling back" framing plus the 10%-off code. Sent ~30 days after email 1 to
 * leads that haven't signed up (i.e. still active). Same compliance envelope as
 * email 1 (From/Reply-To, physical address, one-click unsubscribe). This is the
 * final touch: the copy says so, and the send logic stops after it.
 */
export function buildFollowupEmail(
  lead: OutreachLead,
  promoCode: string,
  discountPercent = 10,
  variant: MessageVariant = "default",
): BuiltEmail {
  // Guardrail: only an approved variant KEY is honored (copy is code-resident);
  // and the ONLY campaign-configurable value that reaches the copy is the discount
  // NUMBER, substituted for the numeral in "{pct}% off" below — every surrounding
  // word is fixed. Changing the number never opens the rest of the approved copy
  // to editing; a new variant/copy is a reviewed code change.
  const v = resolveVariant(variant); void v;
  const pct = clampDiscountPercent(discountPercent);
  const org = lead.org_name;
  const link = unsubUrl(lead.id);
  const site = OUTREACH.appUrl;

  const subject = `Following up for ${org}'s youth ministry`;

  const text =
`Hi ${org} team,

I reached out a few weeks back about It's God, Yo!, our daily Scripture text for teens (${SPANISH_ENABLED ? "English KJV and Spanish Reina-Valera 1909" : "English KJV"}, rewritten into the slang they actually read). No worries if it slipped by.

If it might be a fit for the students at ${org}, here's a code for ${pct}% off any plan, on us:

${promoCode} gets you ${pct}% off at ${site}

Same as before: share it if it helps, ignore it if it's not for you. This is the last you'll hear from us unless you reach out. The link below removes ${org} for good.

Thanks for everything you pour into young people.

Iain Deckard · It's God, Yo!
Reply to this email directly, it comes to me.

---
It's God, Yo!™ is operated by ${OUTREACH.physicalAddress}.
You received this because ${org} is a Wichita-area church with a publicly listed youth ministry. We're proud to say we're local too. We found your general contact address at ${sourceNote(lead)}. Please, help support a local small business!
Unsubscribe (one click): ${link}`;

  const html =
`<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1a1a1a;max-width:600px;margin:0 auto;">
  <p>Hi ${esc(org)} team,</p>
  <p>I reached out a few weeks back about <strong>It's God, Yo!</strong>, our daily Scripture text for teens (${SPANISH_ENABLED ? "English KJV and Spanish Reina-Valera 1909" : "English KJV"}, rewritten into the slang they actually read). No worries if it slipped by.</p>
  <p>If it might be a fit for the students at ${esc(org)}, here's a code for <strong>${pct}% off</strong> any plan, on us:</p>
  <p style="background:#f4f7f7;border:1px solid #d7e2e2;border-radius:8px;padding:12px 16px;font-size:16px;">
    <strong>${esc(promoCode)}</strong> gets you ${pct}% off at <a href="${site}" style="color:#00ABBC;">${esc(site.replace(/^https?:\/\//, ""))}</a>
  </p>
  <p>Same as before: share it if it helps, ignore it if it's not for you. This is the last you'll hear from us unless you reach out. The link below removes ${esc(org)} for good.</p>
  <p style="margin-bottom:2px;">Thanks for everything you pour into young people.</p>
  <p style="margin-bottom:2px;"><strong>Iain Deckard</strong> · It's God, Yo!</p>
  <p style="color:#555;">Reply to this email directly, it comes to me.</p>
  <hr style="border:none;border-top:1px solid #e2e2e2;margin:22px 0;"/>
  <p style="font-size:12px;color:#777;">
    It's God, Yo!™ is operated by ${esc(OUTREACH.physicalAddress)}.<br/>
    You received this because ${esc(org)} is a Wichita-area church with a publicly listed youth ministry. We're proud to say we're local too. We found your general contact address at ${esc(sourceNote(lead))}. Please, help support a local small business!<br/>
    <a href="${link}" style="color:#777;">Unsubscribe (one click)</a>
  </p>
</div>`;

  const headers: Record<string, string> = {
    "List-Unsubscribe": `<${link}>, <mailto:unsubscribe@outreach.itsgodyo.com?subject=unsub-${lead.id}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };

  return { to: lead.contact_email, from: OUTREACH.from, replyTo: OUTREACH.replyTo, subject, text, html, headers };
}

/** Send one built email via Resend (reuses RESEND_API_KEY). Returns the provider
 *  message id on success. Throws on any non-2xx so the caller can record failure
 *  without advancing the lead. */
export async function sendViaResend(email: BuiltEmail): Promise<{ id: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY not set");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: email.from,
      to: [email.to],
      reply_to: email.replyTo,
      subject: email.subject,
      text: email.text,
      html: email.html,
      headers: email.headers,
    }),
  });
  if (!res.ok) throw new Error(`resend_${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json().catch(() => ({}))) as { id?: string };
  return { id: body.id ?? "unknown" };
}
