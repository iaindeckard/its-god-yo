import "server-only";

/**
 * Transactional emails for the Cornerstone Partner Program (spec §"Email
 * notifications"). Every message here is transactional — tied to an action the
 * church itself took (applied) or an admin action on that church's application /
 * partner record — so no marketing-consent gate is needed. We do NOT send
 * anything beyond the nine listed events.
 *
 * Same delivery pattern as lib/bountyEmails.ts: Resend via fetch, reusing
 * RESEND_API_KEY and the shared TRANSACTIONAL_EMAIL_FROM / TRANSACTIONAL_REPLY_TO
 * identity and branded HTML shell. Best-effort: a send failure must NEVER break
 * the primary action (approval, decline, etc.) — sendCornerstoneEmail never
 * throws. If RESEND_API_KEY is unset (local/dev/test) it logs and no-ops.
 */

const FROM = process.env.TRANSACTIONAL_EMAIL_FROM || "It's God, Yo <hello@itsgodyo.com>";
const REPLY_TO = process.env.TRANSACTIONAL_REPLY_TO || "iaindeckard@gmail.com";
const COMPANY_ADDRESS =
  "Deckard Enterprise International, LLC · Wichita, KS 67205";

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

/** "Cornerstone Partner #27" for copy. */
function partnerLabel(n: number): string {
  return `Cornerstone Partner #${n}`;
}

export interface CornerstoneEmail {
  subject: string;
  text: string;
  html: string;
}

// 1 ─ Application received (on submission). ---------------------------------
export function applicationReceivedEmail(churchName: string): CornerstoneEmail {
  return {
    subject: "We received your Cornerstone Partner application",
    text:
`Thank you — we've received ${churchName}'s application to become a Cornerstone Partner of It's God, Yo!

Our team reviews each application personally. We'll follow up at this address with next steps. There's nothing more you need to do right now.

— It's God, Yo!`,
    html: wrapHtml(
`  <p>Thank you — we've received <strong>${esc(churchName)}</strong>'s application to become a Cornerstone Partner of It's God, Yo!</p>
  <p>Our team reviews each application personally. We'll follow up at this address with next steps. There's nothing more you need to do right now.</p>
  <p>— It's God, Yo!</p>`,
    ),
  };
}

// 2 ─ Application approved (recognition first, discount second). -------------
// statusUrl is the church's permanent private link to its Cornerstone status page
// (no login — a signed token). It's the ONLY way in, so this email must carry it.
export function applicationApprovedEmail(churchName: string, partnerNumber: number, statusUrl?: string): CornerstoneEmail {
  const label = partnerLabel(partnerNumber);
  const linkText = statusUrl ? `\n\nView your Cornerstone Partner details anytime:\n${statusUrl}\n(Keep this private link — it's how you reach your Cornerstone page.)` : "";
  const linkHtml = statusUrl
    ? `  <p style="margin:18px 0;"><a href="${esc(statusUrl)}" style="display:inline-block;background:#00ABBC;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;">View your Cornerstone Partner details</a></p>
  <p style="font-size:13px;color:#555;">Keep this private link — it's how you reach your Cornerstone page (there's no separate login).</p>`
    : "";
  return {
    subject: `${churchName} is now a Cornerstone Partner (#${partnerNumber})`,
    text:
`Your church has been approved as a Cornerstone Partner of It's God, Yo!

You are helping establish a new way for churches and families to keep teenagers connected to Scripture between Sundays — and you're now permanently recognized for it.

Your permanent designation: ${label}.${linkText}

Thank you for helping build this from the beginning.

— It's God, Yo!`,
    html: wrapHtml(
`  <p>Your church has been approved as a <strong>Cornerstone Partner</strong> of It's God, Yo!</p>
  <p>You are helping establish a new way for churches and families to keep teenagers connected to Scripture between Sundays — and you're now permanently recognized for it.</p>
  <p>Your permanent designation: <strong>${esc(label)}</strong>.</p>
${linkHtml}
  <p>Thank you for helping build this from the beginning.</p>
  <p>— It's God, Yo!</p>`,
    ),
  };
}

// (recovery) ─ Resend the private status link ("lost your link"). ------------
export function partnerLinkEmail(churchName: string, partnerNumber: number, statusUrl: string): CornerstoneEmail {
  const label = partnerLabel(partnerNumber);
  return {
    subject: "Your Cornerstone Partner link",
    text:
`Here's your private link to ${churchName}'s Cornerstone Partner page (${label}):

${statusUrl}

Keep it somewhere safe — it's how you reach your Cornerstone page, and it doesn't expire.

— It's God, Yo!`,
    html: wrapHtml(
`  <p>Here's your private link to <strong>${esc(churchName)}</strong>'s Cornerstone Partner page (<strong>${esc(label)}</strong>):</p>
  <p style="margin:18px 0;"><a href="${esc(statusUrl)}" style="display:inline-block;background:#00ABBC;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;">Open your Cornerstone page</a></p>
  <p style="font-size:13px;color:#555;">Keep it somewhere safe — it's how you reach your Cornerstone page, and it doesn't expire.</p>
  <p>— It's God, Yo!</p>`,
    ),
  };
}

// 3 ─ Application declined (gracious; never exposes the internal reason). -----
export function applicationDeclinedEmail(churchName: string): CornerstoneEmail {
  return {
    subject: "About your Cornerstone Partner application",
    text:
`Thank you for your interest in the Cornerstone Partner Program and for taking the time to apply on behalf of ${churchName}.

After review, we aren't able to move forward with this application at this time. This doesn't affect your ability to use It's God, Yo, and you're welcome to reach out if you have questions.

Thank you again for your heart for reaching teenagers with Scripture.

— It's God, Yo!`,
    html: wrapHtml(
`  <p>Thank you for your interest in the Cornerstone Partner Program and for taking the time to apply on behalf of <strong>${esc(churchName)}</strong>.</p>
  <p>After review, we aren't able to move forward with this application at this time. This doesn't affect your ability to use It's God, Yo, and you're welcome to reach out if you have questions.</p>
  <p>Thank you again for your heart for reaching teenagers with Scripture.</p>
  <p>— It's God, Yo!</p>`,
    ),
  };
}

// 4 ─ Payment required. ------------------------------------------------------
export function paymentRequiredEmail(churchName: string): CornerstoneEmail {
  return {
    subject: "One more step to activate your Cornerstone Partnership",
    text:
`Good news — ${churchName}'s Cornerstone Partner application has been approved, and there's one remaining step to activate it: completing your subscription payment.

We'll be in touch with the details, or you can reach out and we'll walk you through it. Your Cornerstone Partner recognition is reserved for you in the meantime.

— It's God, Yo!`,
    html: wrapHtml(
`  <p>Good news — <strong>${esc(churchName)}</strong>'s Cornerstone Partner application has been approved, and there's one remaining step to activate it: completing your subscription payment.</p>
  <p>We'll be in touch with the details, or you can reach out and we'll walk you through it. Your Cornerstone Partner recognition is reserved for you in the meantime.</p>
  <p>— It's God, Yo!</p>`,
    ),
  };
}

// 5 ─ Cornerstone Partner activated (reactivation — distinct from approval). --
export function partnerActivatedEmail(churchName: string, partnerNumber: number): CornerstoneEmail {
  const label = partnerLabel(partnerNumber);
  return {
    subject: `Your Cornerstone Partnership is active again (#${partnerNumber})`,
    text:
`${churchName}'s Cornerstone Partnership is active again.

You remain ${label} — your permanent recognition and number never change. Welcome back.

— It's God, Yo!`,
    html: wrapHtml(
`  <p><strong>${esc(churchName)}</strong>'s Cornerstone Partnership is active again.</p>
  <p>You remain <strong>${esc(label)}</strong> — your permanent recognition and number never change. Welcome back.</p>
  <p>— It's God, Yo!</p>`,
    ),
  };
}

// 6 ─ Certificate available. Now wired (certificate/badge generation exists).
// statusUrl is the church's private status page, where the certificate PDF and
// badge (PNG/SVG) download — a real, working link (never empty/broken).
export function certificateAvailableEmail(churchName: string, partnerNumber: number, statusUrl: string): CornerstoneEmail {
  const label = partnerLabel(partnerNumber);
  return {
    subject: "Your Cornerstone Partner certificate & badge are ready",
    text:
`${churchName}'s Cornerstone Partner certificate is ready to download, along with your Cornerstone Partner badge.

It recognizes your church as ${label}. Download your certificate (PDF) and badge (for your website, newsletter, or socials) here:

${statusUrl}

— It's God, Yo!`,
    html: wrapHtml(
`  <p><strong>${esc(churchName)}</strong>'s Cornerstone Partner certificate is ready to download, along with your Cornerstone Partner badge.</p>
  <p>It recognizes your church as <strong>${esc(label)}</strong>.</p>
  <p style="margin:18px 0;"><a href="${esc(statusUrl)}" style="display:inline-block;background:#00ABBC;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;">Download your certificate &amp; badge</a></p>
  <p style="font-size:13px;color:#555;">Use your badge on your church website, newsletter, or socials.</p>
  <p>— It's God, Yo!</p>`,
    ),
  };
}

// 7 ─ Locked pricing changed or removed. -------------------------------------
export function lockedPricingChangedEmail(churchName: string, status: string): CornerstoneEmail {
  const active = status === "active";
  const removed = status === "expired" || status === "none";
  const line = active
    ? "Your Cornerstone qualifying rate is now locked under the Cornerstone Partner terms."
    : status === "suspended"
      ? "Your Cornerstone locked pricing is currently suspended under the Cornerstone Partner terms. Your church remains a Cornerstone Partner."
      : removed
        ? "Your original locked-pricing benefit is no longer active. Your church remains a Cornerstone Partner — the recognition is permanent — but the locked rate no longer applies under the terms."
        : `Your Cornerstone locked-pricing status is now: ${status}.`;
  return {
    subject: "An update to your Cornerstone locked pricing",
    text:
`There's an update to ${churchName}'s Cornerstone locked pricing.

${line}

If you have any questions about this, just reply and we'll help.

— It's God, Yo!`,
    html: wrapHtml(
`  <p>There's an update to <strong>${esc(churchName)}</strong>'s Cornerstone locked pricing.</p>
  <p>${esc(line)}</p>
  <p>If you have any questions about this, just reply and we'll help.</p>
  <p>— It's God, Yo!</p>`,
    ),
  };
}

// 8 ─ Public recognition enabled or disabled. --------------------------------
export function publicRecognitionEmail(churchName: string, enabled: boolean): CornerstoneEmail {
  const line = enabled
    ? "Your church now appears on our public Cornerstone Partners page, with the recognition you approved."
    : "Your church has been removed from the public Cornerstone Partners page. Your Cornerstone Partner recognition itself is unchanged — this only affects public listing.";
  return {
    subject: enabled
      ? "Your church is now recognized on our Cornerstone Partners page"
      : "Your Cornerstone public listing has been turned off",
    text:
`An update on public recognition for ${churchName}.

${line}

— It's God, Yo!`,
    html: wrapHtml(
`  <p>An update on public recognition for <strong>${esc(churchName)}</strong>.</p>
  <p>${esc(line)}</p>
  <p>— It's God, Yo!</p>`,
    ),
  };
}

// 9 ─ Enrollment deadline approaching (scheduled). ---------------------------
export function enrollmentDeadlineEmail(churchName: string, closesOn: string): CornerstoneEmail {
  return {
    subject: "The Cornerstone Partner enrollment window is closing soon",
    text:
`A quick heads-up for ${churchName}: Cornerstone Partner enrollment closes on ${closesOn}.

If your church is still deciding, this is the window to be recognized as a founding Cornerstone Partner. We're glad to answer any questions — just reply.

— It's God, Yo!`,
    html: wrapHtml(
`  <p>A quick heads-up for <strong>${esc(churchName)}</strong>: Cornerstone Partner enrollment closes on <strong>${esc(closesOn)}</strong>.</p>
  <p>If your church is still deciding, this is the window to be recognized as a founding Cornerstone Partner. We're glad to answer any questions — just reply.</p>
  <p>— It's God, Yo!</p>`,
    ),
  };
}

/** Send one Cornerstone transactional email via Resend. Best-effort: never
 *  throws — returns the provider id on success, or logs and returns null on
 *  failure / dry-run (RESEND_API_KEY unset) / no recipient. */
export async function sendCornerstoneEmail(to: string | null | undefined, email: CornerstoneEmail): Promise<string | null> {
  if (!to) {
    console.log(`[cornerstone-email] skipped (no recipient) subject="${email.subject}"`);
    return null;
  }
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`[cornerstone-email dry-run] to=${to} subject="${email.subject}" (RESEND_API_KEY unset)`);
    return null;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [to], reply_to: REPLY_TO, subject: email.subject, text: email.text, html: email.html }),
    });
    if (!res.ok) {
      console.error(`[cornerstone-email] resend_${res.status} to=${to}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const body = (await res.json().catch(() => ({}))) as { id?: string };
    return body.id ?? "unknown";
  } catch (e) {
    console.error(`[cornerstone-email] send failed to=${to}:`, e instanceof Error ? e.message : e);
    return null;
  }
}
