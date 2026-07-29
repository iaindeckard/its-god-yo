import "server-only";

/**
 * Transactional emails for the translation/reword error bounty (spec §10).
 *
 * Four outcomes, all warm and never discouraging:
 *   - earned    : your report was confirmed and a credit is on the way
 *   - notFirst  : confirmed, but someone reported it first — no reward, keep going
 *   - rejected  : we reviewed and it wasn't an error — thank you, keep going
 *   - capped    : you've hit this year's max — thank you, keep reporting anyway
 *   - snag      : confirmed + you were first, but we couldn't auto-credit your
 *                 account (no active subscription matched) — we'll follow up
 *
 * These are transactional account-service messages (a customer's own report
 * outcome), sent from the customer-facing itsgodyo.com domain via Resend
 * (reusing RESEND_API_KEY). Best-effort: a send failure must NEVER break credit
 * issuance — callers wrap these so a bounced email can't undo a Stripe credit.
 * If RESEND_API_KEY is unset (local/dev/test), we log and no-op ("dry-run").
 */

const FROM = process.env.TRANSACTIONAL_EMAIL_FROM || "It's God, Yo <hello@itsgodyo.com>";
const REPLY_TO = process.env.TRANSACTIONAL_REPLY_TO || "iaindeckard@gmail.com";
const COMPANY_ADDRESS =
  "Deckard Enterprise International, LLC · 2221 N Amarado St, Wichita, KS 67205";

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

function wrapHtml(bodyHtml: string): string {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1a1a1a;max-width:600px;margin:0 auto;">
${bodyHtml}
  <hr style="border:none;border-top:1px solid #e2e2e2;margin:22px 0;"/>
  <p style="font-size:12px;color:#777;">It's God, Yo!™ · ${esc(COMPANY_ADDRESS)}</p>
</div>`;
}

export interface BountyEmail {
  subject: string;
  text: string;
  html: string;
}

/** Confirmed + this reporter was first → a credit is on the way. */
export function earnedEmail(verseRef: string, amountCents: number): BountyEmail {
  const amt = usd(amountCents);
  return {
    subject: "Thank you — your It's God, Yo! report earned a credit",
    text:
`Thank you for reporting an issue with ${verseRef}.

You were the first to catch it, so we've added a ${amt} credit to your account. It'll show up automatically on your next invoice — nothing for you to do.

Reports like yours are exactly how we keep the Word accurate for every teen reading it. Please keep them coming.

— It's God, Yo!`,
    html: wrapHtml(
`  <p>Thank you for reporting an issue with <strong>${esc(verseRef)}</strong>.</p>
  <p>You were the first to catch it, so we've added a <strong>${esc(amt)}</strong> credit to your account. It'll show up automatically on your next invoice — nothing for you to do.</p>
  <p>Reports like yours are exactly how we keep the Word accurate for every teen reading it. Please keep them coming.</p>
  <p>— It's God, Yo!</p>`,
    ),
  };
}

/** Confirmed, but someone else reported the same thing first. */
export function notFirstEmail(verseRef: string): BountyEmail {
  return {
    subject: "Thank you for your It's God, Yo! report",
    text:
`Thank you for reporting an issue with ${verseRef}.

You were right — but someone reported this exact one just before you, so the credit went to them this time. That takes nothing away from your catch, and we're grateful for it.

Please keep reporting anything that looks off. The next one could be yours first.

— It's God, Yo!`,
    html: wrapHtml(
`  <p>Thank you for reporting an issue with <strong>${esc(verseRef)}</strong>.</p>
  <p>You were right — but someone reported this exact one just before you, so the credit went to them this time. That takes nothing away from your catch, and we're grateful for it.</p>
  <p>Please keep reporting anything that looks off. The next one could be yours first.</p>
  <p>— It's God, Yo!</p>`,
    ),
  };
}

/** Reviewed and determined not to be an error. */
export function rejectedEmail(verseRef: string): BountyEmail {
  return {
    subject: "Thank you for your It's God, Yo! report",
    text:
`Thank you for reporting ${verseRef} and taking the time to help.

We took a close look, and on this one the text is actually correct as written — sometimes the teen wording reads differently than expected but still faithfully carries the meaning. No credit this time, but we genuinely appreciate you looking closely.

Please keep reporting anything that seems off. It all helps.

— It's God, Yo!`,
    html: wrapHtml(
`  <p>Thank you for reporting <strong>${esc(verseRef)}</strong> and taking the time to help.</p>
  <p>We took a close look, and on this one the text is actually correct as written — sometimes the teen wording reads differently than expected but still faithfully carries the meaning. No credit this time, but we genuinely appreciate you looking closely.</p>
  <p>Please keep reporting anything that seems off. It all helps.</p>
  <p>— It's God, Yo!</p>`,
    ),
  };
}

/** Confirmed + first, but the reporter has reached this year's credit cap. */
export function cappedEmail(verseRef: string): BountyEmail {
  return {
    subject: "Thank you — great catch on your It's God, Yo! report",
    text:
`Thank you for reporting ${verseRef} — and you were first to catch it.

You've already reached the maximum error-report credit for this year, so we can't add another one right now. But your report still counts: we've confirmed the fix, and catches like yours keep the text accurate for everyone.

Please don't stop reporting. Your eyes on this genuinely help, reward or not.

— It's God, Yo!`,
    html: wrapHtml(
`  <p>Thank you for reporting <strong>${esc(verseRef)}</strong> — and you were first to catch it.</p>
  <p>You've already reached the maximum error-report credit for this year, so we can't add another one right now. But your report still counts: we've confirmed the fix, and catches like yours keep the text accurate for everyone.</p>
  <p>Please don't stop reporting. Your eyes on this genuinely help, reward or not.</p>
  <p>— It's God, Yo!</p>`,
    ),
  };
}

/** Confirmed + first, but we couldn't auto-apply the credit (no active
 *  subscription matched to credit). We owe them a personal follow-up. */
export function snagEmail(verseRef: string): BountyEmail {
  return {
    subject: "Thank you — we're sorting out your It's God, Yo! credit",
    text:
`Thank you for reporting an issue with ${verseRef} — you were the first to catch it, and you've earned a credit.

We hit a snag applying it to your account automatically (we couldn't match an active subscription to credit). Nothing is lost — we'll sort this out and follow up with you personally to make sure you get it.

Thank you for your patience, and please keep reporting anything that looks off.

— It's God, Yo!`,
    html: wrapHtml(
`  <p>Thank you for reporting an issue with <strong>${esc(verseRef)}</strong> — you were the first to catch it, and you've earned a credit.</p>
  <p>We hit a snag applying it to your account automatically (we couldn't match an active subscription to credit). Nothing is lost — we'll sort this out and follow up with you personally to make sure you get it.</p>
  <p>Thank you for your patience, and please keep reporting anything that looks off.</p>
  <p>— It's God, Yo!</p>`,
    ),
  };
}

/** Send one transactional email via Resend. Best-effort: never throws — returns
 *  the provider id on success, or logs and returns null on failure / dry-run. */
export async function sendBountyEmail(to: string, email: BountyEmail): Promise<string | null> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`[bounty-email dry-run] to=${to} subject="${email.subject}" (RESEND_API_KEY unset)`);
    return null;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        reply_to: REPLY_TO,
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
    });
    if (!res.ok) {
      console.error(`[bounty-email] resend_${res.status} to=${to}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const body = (await res.json().catch(() => ({}))) as { id?: string };
    return body.id ?? "unknown";
  } catch (e) {
    console.error(`[bounty-email] send failed to=${to}:`, e instanceof Error ? e.message : e);
    return null;
  }
}
