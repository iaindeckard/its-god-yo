import "server-only";

/**
 * Transactional emails for the Christmas Scheduled Gift non-confirmation credit.
 *
 * Two DISTINCT outcomes, same credit underneath, different message:
 *   - nonConfirmation : the recipient never replied YES after the resend ceiling, or
 *                       texted STOP, so the gift could not be activated. (Also reused
 *                       for the STOP-before-confirm case.)
 *   - ageGateFailure  : the recipient did not meet the age/consent requirement for
 *                       their country, so the gift could not be activated.
 *
 * Best-effort (mirrors sendBountyEmail): a send failure must NEVER undo a Stripe credit,
 * so this returns null on failure/dry-run and never throws. Copy is Iain-approved.
 */

const FROM = process.env.TRANSACTIONAL_EMAIL_FROM || "It's God, Yo <hello@itsgodyo.com>";
const REPLY_TO = process.env.TRANSACTIONAL_REPLY_TO || "iaindeckard@gmail.com";
const COMPANY_ADDRESS = "Deckard Enterprise International, LLC · 2221 N Amarado St, Wichita, KS 67205";

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

export interface ChristmasGiftEmail {
  subject: string;
  text: string;
  html: string;
}

interface CreditEmailArgs {
  purchaserFirstName?: string | null;
  recipientFirstName?: string | null;
  amountCents: number;
}

const hi = (name?: string | null) => `Hi ${name?.trim() || "there"},`;
const who = (name?: string | null) => name?.trim() || "your recipient";

/** Generic non-confirmation (no reply after the ceiling, or STOP) -> credit. */
export function nonConfirmationCreditEmail(args: CreditEmailArgs): ChristmasGiftEmail {
  const r = who(args.recipientFirstName);
  const amount = usd(args.amountCents);
  const text =
    `${hi(args.purchaserFirstName)}\n\n` +
    `Thank you again for your It's God, Yo! Christmas gift for ${r}.\n\n` +
    `We texted ${r} to confirm their gift and followed up afterward, but we did not receive a reply to start it. We never begin sending messages to anyone who has not personally confirmed, so we were not able to activate this gift.\n\n` +
    `Your payment has not been lost. As stated at checkout, we have converted the full amount you paid, ${amount}, into It's God, Yo! account credit. You can apply it toward a future gift or your own subscription, and no action is needed to keep it.\n\n` +
    `If you think this was a mistake, or ${r}'s number may have changed, just reply to this email and we will help.\n\n` +
    `Thank you,\nThe It's God, Yo! team`;
  const html = wrapHtml(
    `<p>${esc(hi(args.purchaserFirstName))}</p>
  <p>Thank you again for your It's God, Yo! Christmas gift for ${esc(r)}.</p>
  <p>We texted ${esc(r)} to confirm their gift and followed up afterward, but we did not receive a reply to start it. We never begin sending messages to anyone who has not personally confirmed, so we were not able to activate this gift.</p>
  <p>Your payment has not been lost. As stated at checkout, we have converted the full amount you paid, ${esc(amount)}, into It's God, Yo! account credit. You can apply it toward a future gift or your own subscription, and no action is needed to keep it.</p>
  <p>If you think this was a mistake, or ${esc(r)}'s number may have changed, just reply to this email and we will help.</p>
  <p>Thank you,<br/>The It's God, Yo! team</p>`,
  );
  return { subject: "Your It's God, Yo! gift has been converted to account credit", text, html };
}

/** Age/consent requirement not met -> credit. Distinct, specific reason. */
export function ageGateFailureCreditEmail(args: CreditEmailArgs): ChristmasGiftEmail {
  const r = who(args.recipientFirstName);
  const amount = usd(args.amountCents);
  const text =
    `${hi(args.purchaserFirstName)}\n\n` +
    `Thank you for your It's God, Yo! Christmas gift for ${r}.\n\n` +
    `Before sending anything, we confirm that each recipient meets the age and consent requirements for their country. Based on the information provided, ${r} does not currently meet those requirements, so we were not able to activate this gift.\n\n` +
    `Your payment has not been lost. We have converted the full amount you paid, ${amount}, into It's God, Yo! account credit, which you can use toward a different gift or your own subscription. No action is needed.\n\n` +
    `If you believe this was a mistake, for example if a birth year was entered incorrectly, reply to this email and we will be glad to help.\n\n` +
    `Thank you,\nThe It's God, Yo! team`;
  const html = wrapHtml(
    `<p>${esc(hi(args.purchaserFirstName))}</p>
  <p>Thank you for your It's God, Yo! Christmas gift for ${esc(r)}.</p>
  <p>Before sending anything, we confirm that each recipient meets the age and consent requirements for their country. Based on the information provided, ${esc(r)} does not currently meet those requirements, so we were not able to activate this gift.</p>
  <p>Your payment has not been lost. We have converted the full amount you paid, ${esc(amount)}, into It's God, Yo! account credit, which you can use toward a different gift or your own subscription. No action is needed.</p>
  <p>If you believe this was a mistake, for example if a birth year was entered incorrectly, reply to this email and we will be glad to help.</p>
  <p>Thank you,<br/>The It's God, Yo! team</p>`,
  );
  return { subject: `About your It's God, Yo! gift for ${r}`, text, html };
}

interface ReceiptArgs {
  purchaserFirstName?: string | null;
  recipientFirstName?: string | null;
  chargedCents: number;
  listCents: number;
  purchaseWindow: "early_bird" | "flash_sale" | "standard";
  dmfhBonus: boolean;
  releaseAt: string; // YYYY-MM-DD
}

/** Purchaser receipt, sent once the charge settles. States the window, list price, amount
 *  charged, DMFH bonus, and restates the prepaid/no-trial/credit-on-non-confirmation terms. */
export function christmasGiftReceiptEmail(args: ReceiptArgs): ChristmasGiftEmail {
  const r = who(args.recipientFirstName);
  const charged = usd(args.chargedCents);
  const discounted = args.purchaseWindow === "flash_sale" && args.listCents > args.chargedCents;
  const savedLine = discounted ? `List price ${usd(args.listCents)}, you saved ${usd(args.listCents - args.chargedCents)} (Black Friday special).` : "";
  const bonusLine = args.dmfhBonus ? "Includes DM from Him free for the gifted year." : "";

  const lines = [
    "Prepaid one-year gift subscription",
    `Charged today: ${charged}`,
    savedLine,
    bonusLine,
    `Scheduled: we will text ${r} to confirm on ${args.releaseAt}.`,
  ].filter(Boolean);

  const text =
    `${hi(args.purchaserFirstName)}\n\n` +
    `Thank you for your It's God, Yo! Christmas gift for ${r}. Here is your receipt.\n\n` +
    lines.map((l) => `- ${l}`).join("\n") +
    `\n\nA few reminders. Your card was charged today. There is no free trial on this purchase. It is not eligible for a cash refund. If your recipient never confirms, or does not meet the age or consent requirements for their country, your payment converts to It's God, Yo! account credit. Their year of daily messages begins only after they reply YES to confirm.\n\n` +
    `Questions? Just reply to this email.\n\n` +
    `Thank you,\nThe It's God, Yo! team`;

  const html = wrapHtml(
    `<p>${esc(hi(args.purchaserFirstName))}</p>
  <p>Thank you for your It's God, Yo! Christmas gift for ${esc(r)}. Here is your receipt.</p>
  <ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
  <p>A few reminders. Your card was charged today. There is no free trial on this purchase. It is not eligible for a cash refund. If your recipient never confirms, or does not meet the age or consent requirements for their country, your payment converts to It's God, Yo! account credit. Their year of daily messages begins only after they reply YES to confirm.</p>
  <p>Questions? Just reply to this email.</p>
  <p>Thank you,<br/>The It's God, Yo! team</p>`,
  );
  return { subject: "Your It's God, Yo! Christmas gift is confirmed", text, html };
}

/** Send one transactional email via Resend. Best-effort: never throws. */
export async function sendChristmasGiftEmail(to: string, email: ChristmasGiftEmail): Promise<string | null> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`[christmas-gift-email dry-run] to=${to} subject="${email.subject}" (RESEND_API_KEY unset)`);
    return null;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [to], reply_to: REPLY_TO, subject: email.subject, text: email.text, html: email.html }),
    });
    if (!res.ok) {
      console.error(`[christmas-gift-email] resend_${res.status} to=${to}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const body = (await res.json().catch(() => ({}))) as { id?: string };
    return body.id ?? "unknown";
  } catch (e) {
    console.error(`[christmas-gift-email] send failed to=${to}:`, e instanceof Error ? e.message : e);
    return null;
  }
}
