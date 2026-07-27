import "server-only";
import crypto from "crypto";
import { OUTREACH } from "./config";
import type { OutreachLead } from "./leads";

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
 * Build the compliant outreach email (spec §2). NOTE: the copy here is PENDING
 * Iain's explicit approval — it is not sent to any real org until the send gate
 * (see config.sendGate) is opened. Every send carries: honest From/Subject,
 * one-click List-Unsubscribe (RFC 8058) + a visible link, the required physical
 * mailing address, and Reply-To to a monitored human inbox.
 */
export function buildEmail(lead: OutreachLead, promoCode: string): BuiltEmail {
  const org = lead.org_name;
  const link = unsubUrl(lead.id);
  const site = OUTREACH.appUrl;

  const subject = `A youth-ministry partner offer from It's God, Yo — 10% off for ${org}`;

  const text =
`Hi ${org} team,

I'm Iain, founder of It's God, Yo! — a daily Scripture text-message devotional built for teens, in both English (KJV) and Spanish (Reina-Valera 1909). It's a simple way for a young person to get one grounded verse and a short, real-language reflection every day.

I'm reaching out because ${org} has an active youth ministry, and I'd love to make It's God, Yo available to your students and families at a discount. Here's a code for 10% off any plan, just for your community:

  ${promoCode} — 10% off at ${site}

No pressure and no obligation — if it's a fit, share it with your families; if not, no worries at all. And if you'd rather not hear from us again, the one-click link below removes ${org} permanently.

Grateful for the work you do with young people,
Iain Deckard · It's God, Yo!
Reply straight to this email — it comes to me personally.

---
It's God, Yo! is operated by ${OUTREACH.physicalAddress}.
You received this because ${org} is a church in ${OUTREACH.geography} with a publicly listed youth ministry; we found your general contact address at ${sourceNote(lead)}.
Unsubscribe (one click): ${link}`;

  const html =
`<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1a1a1a;max-width:600px;margin:0 auto;">
  <p>Hi ${esc(org)} team,</p>
  <p>I'm Iain, founder of <strong>It's God, Yo!</strong> — a daily Scripture text-message devotional built for teens, in both English (KJV) and Spanish (Reina-Valera 1909). It's a simple way for a young person to get one grounded verse and a short, real-language reflection every day.</p>
  <p>I'm reaching out because ${esc(org)} has an active youth ministry, and I'd love to make It's God, Yo available to your students and families at a discount. Here's a code for <strong>10% off</strong> any plan, just for your community:</p>
  <p style="background:#f4f7f7;border:1px solid #d7e2e2;border-radius:8px;padding:12px 16px;font-size:16px;">
    <strong>${esc(promoCode)}</strong> — 10% off at <a href="${site}" style="color:#00ABBC;">${esc(site.replace(/^https?:\/\//, ""))}</a>
  </p>
  <p>No pressure and no obligation — if it's a fit, share it with your families; if not, no worries at all. And if you'd rather not hear from us again, the one-click link below removes ${esc(org)} permanently.</p>
  <p style="margin-bottom:2px;">Grateful for the work you do with young people,<br/>
  <strong>Iain Deckard</strong> · It's God, Yo!</p>
  <p style="color:#555;">Reply straight to this email — it comes to me personally.</p>
  <hr style="border:none;border-top:1px solid #e2e2e2;margin:22px 0;"/>
  <p style="font-size:12px;color:#777;">
    It's God, Yo!™ is operated by ${esc(OUTREACH.physicalAddress)}.<br/>
    You received this because ${esc(org)} is a church in ${esc(OUTREACH.geography)} with a publicly listed youth ministry; we found your general contact address at ${esc(sourceNote(lead))}.<br/>
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
