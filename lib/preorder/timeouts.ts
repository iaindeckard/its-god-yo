import "server-only";
import { getSupabaseAdmin } from "../supabaseAdmin";
import { confirmationReminder, paymentReminder } from "./messages";
import { sendPreorderSms, sendPreorderEmail } from "./notify";
import { getSignupRecipients } from "./recipients";
import { retryUrl } from "./token";
import { removePreorderSignup } from "./removal";

/**
 * Daily preorder timeout sweep (spec steps 3 + 5), scoped to is_preorder rows so
 * the normal signup flow is untouched. Two independent clocks:
 *
 *  awaiting_confirmation (clock = confirmation_sent_at):
 *    >= 7d           -> timeout, remove (reason='no_response')
 *    >= 3d, no nudge -> one reminder (SMS to recipients + email to purchaser)
 *
 *  payment_failed (clock = payment_failed_at):
 *    >= 7d           -> timeout, remove (reason='payment_failed')
 *    >= 3d, no nudge -> one reminder (email to purchaser w/ retry link)
 *
 * The immediate "card declined" notice is sent at the moment of failure by the
 * YES handler; this cron only does the 3-day nudge + 7-day cutoff.
 */
const DAY = 24 * 60 * 60 * 1000;
const REMINDER_AFTER_MS = 3 * DAY;
const TIMEOUT_AFTER_MS = 7 * DAY;

export interface TimeoutSummary {
  ran_at: string;
  dry_run: boolean;
  confirmation: { reminders: number; removed: number };
  payment_failed: { reminders: number; removed: number };
  errors: Array<{ pending_signup_id: string; stage: string; error: string }>;
}

export async function runPreorderTimeouts(dryRun = false): Promise<TimeoutSummary> {
  const admin = getSupabaseAdmin();
  const now = Date.now();
  const nowIso = new Date().toISOString();
  const summary: TimeoutSummary = {
    ran_at: nowIso, dry_run: dryRun,
    confirmation: { reminders: 0, removed: 0 },
    payment_failed: { reminders: 0, removed: 0 },
    errors: [],
  };

  const age = (ts: string | null): number | null => (ts ? now - new Date(ts).getTime() : null);

  // ---------------- Confirmation timeouts (awaiting_confirmation) ----------------
  const { data: awaiting } = await admin
    .from("pending_signups")
    .select("id, teen_consent_id, plus_one_consent_id, purchaser_email, language, confirmation_sent_at, confirmation_reminder_sent_at")
    .eq("is_preorder", true)
    .eq("status", "awaiting_confirmation");

  for (const su of awaiting ?? []) {
    try {
      const a = age(su.confirmation_sent_at as string | null);
      if (a === null) continue; // never invited (shouldn't happen); leave it
      if (a >= TIMEOUT_AFTER_MS) {
        if (!dryRun) {
          const r = await removePreorderSignup(su.id as string, "no_response");
          if (r.removed) summary.confirmation.removed++;
        } else summary.confirmation.removed++;
      } else if (a >= REMINDER_AFTER_MS && !su.confirmation_reminder_sent_at) {
        if (!dryRun) {
          const recipients = await getSignupRecipients(su);
          for (const rec of recipients) await sendPreorderSms(rec.phone, confirmationReminder(rec.name, rec.lang).sms);
          const emailLang = su.language === "es" ? "es" : "en";
          await sendPreorderEmail((su.purchaser_email as string | null) ?? null, confirmationReminder(null, emailLang).email);
          await admin.from("pending_signups").update({ confirmation_reminder_sent_at: nowIso }).eq("id", su.id);
        }
        summary.confirmation.reminders++;
      }
    } catch (e) {
      summary.errors.push({ pending_signup_id: su.id as string, stage: "confirmation", error: e instanceof Error ? e.message : "unknown" });
    }
  }

  // ---------------- Payment-failure timeouts (payment_failed) ----------------
  const { data: failed } = await admin
    .from("pending_signups")
    .select("id, purchaser_email, language, payment_failed_at, payment_failed_reminder_sent_at")
    .eq("is_preorder", true)
    .eq("status", "payment_failed");

  for (const su of failed ?? []) {
    try {
      const a = age(su.payment_failed_at as string | null);
      if (a === null) continue;
      if (a >= TIMEOUT_AFTER_MS) {
        if (!dryRun) {
          const r = await removePreorderSignup(su.id as string, "payment_failed");
          if (r.removed) summary.payment_failed.removed++;
        } else summary.payment_failed.removed++;
      } else if (a >= REMINDER_AFTER_MS && !su.payment_failed_reminder_sent_at) {
        if (!dryRun) {
          const emailLang = su.language === "es" ? "es" : "en";
          await sendPreorderEmail((su.purchaser_email as string | null) ?? null, paymentReminder(null, emailLang, retryUrl(su.id as string)).email);
          await admin.from("pending_signups").update({ payment_failed_reminder_sent_at: nowIso }).eq("id", su.id);
        }
        summary.payment_failed.reminders++;
      }
    } catch (e) {
      summary.errors.push({ pending_signup_id: su.id as string, stage: "payment_failed", error: e instanceof Error ? e.message : "unknown" });
    }
  }

  return summary;
}
