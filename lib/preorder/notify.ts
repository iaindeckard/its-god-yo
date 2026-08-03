import "server-only";
import type { PreorderEmail, PreorderMessage } from "./messages";

/**
 * Best-effort SMS + email delivery for the preorder / activation flow. Mirrors the
 * existing helpers: SMS via Twilio REST (like lib/dailySend.ts), email via Resend
 * (like lib/cornerstoneEmails.ts). Neither throws — a delivery failure must never
 * break the state transition that triggered it. If credentials are unset (local /
 * dev / Twilio-not-yet-verified) each no-ops and logs.
 */

const FROM_EMAIL = process.env.TRANSACTIONAL_EMAIL_FROM || "It's God, Yo <hello@itsgodyo.com>";
const REPLY_TO = process.env.TRANSACTIONAL_REPLY_TO || "iaindeckard@gmail.com";

export async function sendPreorderSms(to: string | null | undefined, body: string): Promise<{ ok: boolean; sid?: string; error?: string }> {
  if (!to) return { ok: false, error: "no_recipient" };
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!accountSid || !token || !from) {
    console.log(`[preorder-sms dry-run] to=${to} (Twilio not configured): ${body.slice(0, 80)}`);
    return { ok: false, error: "twilio_not_configured" };
  }
  try {
    const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${accountSid}:${token}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ From: from, To: to, Body: body }).toString(),
    });
    const data = (await resp.json().catch(() => ({}))) as { sid?: string; message?: string };
    if (!resp.ok) {
      console.error(`[preorder-sms] twilio_${resp.status} to=${to}: ${String(data?.message ?? "").slice(0, 140)}`);
      return { ok: false, error: `twilio_${resp.status}` };
    }
    return { ok: true, sid: data.sid };
  } catch (e) {
    console.error(`[preorder-sms] send failed to=${to}:`, e instanceof Error ? e.message : e);
    return { ok: false, error: "send_failed" };
  }
}

export async function sendPreorderEmail(to: string | null | undefined, email: PreorderEmail): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!to) return { ok: false, error: "no_recipient" };
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`[preorder-email dry-run] to=${to} subject="${email.subject}" (RESEND_API_KEY unset)`);
    return { ok: false, error: "resend_not_configured" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM_EMAIL, to: [to], reply_to: REPLY_TO, subject: email.subject, text: email.text, html: email.html }),
    });
    if (!res.ok) {
      console.error(`[preorder-email] resend_${res.status} to=${to}: ${(await res.text()).slice(0, 200)}`);
      return { ok: false, error: `resend_${res.status}` };
    }
    const body = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, id: body.id };
  } catch (e) {
    console.error(`[preorder-email] send failed to=${to}:`, e instanceof Error ? e.message : e);
    return { ok: false, error: "send_failed" };
  }
}

/** Send both channels for a composed message. Best-effort; returns per-channel outcome. */
export async function notifyPreorder(
  phone: string | null | undefined,
  emailAddr: string | null | undefined,
  msg: PreorderMessage,
): Promise<{ sms: boolean; email: boolean }> {
  const [sms, email] = await Promise.all([
    sendPreorderSms(phone, msg.sms),
    sendPreorderEmail(emailAddr, msg.email),
  ]);
  return { sms: sms.ok, email: email.ok };
}
