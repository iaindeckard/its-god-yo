import "server-only";
import nodemailer from "nodemailer";
import { getSupabaseAdmin } from "./supabaseAdmin";

/**
 * Sponsor lead capture. On submit we ALWAYS persist the inquiry (a lead is never
 * lost) and then best-effort email a notification to hello@itsgodyo.com so a
 * real conversation can start. This is not a review queue / approval flow —
 * vetting still happens manually before Iain adds an active sponsor.
 *
 * Two supported senders, tried in this order:
 *   1) Resend — set RESEND_API_KEY (and optionally SPONSOR_EMAIL_FROM; the from
 *      domain must be verified in Resend). Preferred: no SMTP setup, works well
 *      on Vercel.
 *   2) SMTP (e.g. the Microsoft 365 mailbox) — set SPONSOR_SMTP_HOST
 *      (smtp.office365.com), SPONSOR_SMTP_PORT (587), SPONSOR_SMTP_USER
 *      (hello@itsgodyo.com), and SPONSOR_SMTP_PASSWORD (or SPONSOR_SMTP_PASS).
 * Common: SPONSOR_NOTIFY_TO (default hello@itsgodyo.com).
 *
 * When neither is configured, the lead is still persisted and the visitor still
 * sees the confirmation — the notification is simply skipped (logged).
 */

const NOTIFY_TO = process.env.SPONSOR_NOTIFY_TO || "hello@itsgodyo.com";
// For Resend the from address must be on a domain verified in Resend.
const EMAIL_FROM = process.env.SPONSOR_EMAIL_FROM || "It's God, Yo <onboarding@resend.dev>";

export interface InquiryInput {
  orgName: string;
  contactName: string;
  email: string;
  message?: string;
}

function validEmail(e: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
}

function notificationBody(inquiry: InquiryInput) {
  return {
    subject: `Sponsor inquiry — ${inquiry.orgName}`,
    text:
      `New sponsor inquiry from the It's God, Yo site:\n\n` +
      `Organization: ${inquiry.orgName}\n` +
      `Contact: ${inquiry.contactName}\n` +
      `Email: ${inquiry.email}\n\n` +
      `Message:\n${inquiry.message?.trim() || "(none)"}\n`,
  };
}

async function sendViaResend(apiKey: string, inquiry: InquiryInput): Promise<{ sent: boolean; error: string | null }> {
  const { subject, text } = notificationBody(inquiry);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: EMAIL_FROM, to: [NOTIFY_TO], reply_to: inquiry.email, subject, text }),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    return { sent: false, error: `resend_${res.status}: ${detail}` };
  }
  return { sent: true, error: null };
}

async function sendViaSmtp(inquiry: InquiryInput): Promise<{ sent: boolean; error: string | null }> {
  const host = process.env.SPONSOR_SMTP_HOST;
  const user = process.env.SPONSOR_SMTP_USER;
  const pass = process.env.SPONSOR_SMTP_PASSWORD || process.env.SPONSOR_SMTP_PASS;
  const port = Number(process.env.SPONSOR_SMTP_PORT || 587);
  if (!host || !user || !pass) return { sent: false, error: "smtp_not_configured" };
  const { subject, text } = notificationBody(inquiry);
  const transport = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  await transport.sendMail({ from: user, to: NOTIFY_TO, replyTo: inquiry.email, subject, text });
  return { sent: true, error: null };
}

async function sendNotification(inquiry: InquiryInput): Promise<{ sent: boolean; error: string | null }> {
  const resendKey = process.env.RESEND_API_KEY;
  const smtpConfigured = process.env.SPONSOR_SMTP_HOST && process.env.SPONSOR_SMTP_USER && (process.env.SPONSOR_SMTP_PASSWORD || process.env.SPONSOR_SMTP_PASS);
  try {
    if (resendKey) return await sendViaResend(resendKey, inquiry);
    if (smtpConfigured) return await sendViaSmtp(inquiry);
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : "send_failed" };
  }
  console.log(`[sponsor-inquiry] No email sender configured (set RESEND_API_KEY or SPONSOR_SMTP_*) — notification skipped, lead persisted. Would notify ${NOTIFY_TO} re: ${inquiry.orgName}`);
  return { sent: false, error: "email_not_configured" };
}

export async function submitInquiry(input: InquiryInput): Promise<{ ok: true; id: string; notified: boolean }> {
  const orgName = input.orgName?.trim();
  const contactName = input.contactName?.trim();
  const email = input.email?.trim();
  const message = input.message?.trim() || null;
  if (!orgName) throw new Error("organization name is required");
  if (!contactName) throw new Error("contact name is required");
  if (!email || !validEmail(email)) throw new Error("a valid email is required");

  const admin = getSupabaseAdmin();
  // Persist first — the durable record. A lead is never lost even if email fails.
  const { data, error } = await admin
    .from("igy_sponsor_inquiries")
    .insert({ org_name: orgName, contact_name: contactName, email, message })
    .select("id")
    .single();
  if (error) throw new Error(`inquiry_insert_failed: ${error.message}`);

  const { sent, error: notifyError } = await sendNotification({ orgName, contactName, email, message: message ?? undefined });
  await admin.from("igy_sponsor_inquiries").update({ notified: sent, notify_error: notifyError }).eq("id", data.id);

  return { ok: true, id: data.id as string, notified: sent };
}
