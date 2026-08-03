import "server-only";
import { getSupabaseAdmin } from "../supabaseAdmin";
import { launchConfirmation } from "./messages";
import { sendPreorderSms, sendPreorderEmail } from "./notify";
import { getSignupRecipients } from "./recipients";

/**
 * Launch trigger (spec step 2) — admin-initiated, one-time batch, INDEPENDENT of
 * the PREORDER_MODE flag. Moves every status='preorder_pending' signup to
 * awaiting_confirmation, stamps confirmation_sent_at, and sends the "reply YES to
 * activate" invite: SMS to each recipient (who replies YES) + email to the
 * purchaser (the cardholder).
 *
 * Re-runnable: a signup only advances if at least one channel delivered. If both
 * SMS and email fail (e.g. Twilio not yet credentialed), it STAYS preorder_pending
 * so a later run retries it — we never mark someone "invited" who wasn't reachable.
 * With dryRun=true it reports what WOULD be sent and changes nothing.
 */
export interface LaunchSummary {
  ran_at: string;
  dry_run: boolean;
  candidates: number;
  promoted: number;
  sms_sent: number;
  email_sent: number;
  skipped_unreachable: number;
  errors: Array<{ pending_signup_id: string; error: string }>;
}

export async function runLaunchTrigger(dryRun = false): Promise<LaunchSummary> {
  const admin = getSupabaseAdmin();
  const nowIso = new Date().toISOString();
  const summary: LaunchSummary = {
    ran_at: nowIso, dry_run: dryRun, candidates: 0, promoted: 0, sms_sent: 0, email_sent: 0, skipped_unreachable: 0, errors: [],
  };

  const { data: signups, error } = await admin
    .from("pending_signups")
    .select("id, teen_consent_id, plus_one_consent_id, purchaser_email, language")
    .eq("status", "preorder_pending");
  if (error) throw new Error(`launch_query_failed: ${error.message}`);
  summary.candidates = (signups ?? []).length;

  for (const su of signups ?? []) {
    try {
      const recipients = await getSignupRecipients(su);
      const purchaserEmail = (su.purchaser_email as string | null) ?? null;
      const emailLang = su.language === "es" ? "es" : "en";

      if (dryRun) {
        summary.promoted++; // would promote
        if (recipients.length) summary.sms_sent += recipients.length;
        if (purchaserEmail) summary.email_sent++;
        continue;
      }

      let anyDelivered = false;
      // SMS to each recipient (the one who replies YES).
      for (const r of recipients) {
        const msg = launchConfirmation(r.name, r.lang);
        const res = await sendPreorderSms(r.phone, msg.sms);
        if (res.ok) { summary.sms_sent++; anyDelivered = true; }
      }
      // Email to the purchaser (cardholder).
      if (purchaserEmail) {
        const emsg = launchConfirmation(null, emailLang);
        const eres = await sendPreorderEmail(purchaserEmail, emsg.email);
        if (eres.ok) { summary.email_sent++; anyDelivered = true; }
      }

      if (!anyDelivered) { summary.skipped_unreachable++; continue; } // stays preorder_pending

      const { error: upErr } = await admin
        .from("pending_signups")
        .update({ status: "awaiting_confirmation", confirmation_sent_at: nowIso })
        .eq("id", su.id)
        .eq("status", "preorder_pending"); // guard against a concurrent run
      if (upErr) { summary.errors.push({ pending_signup_id: su.id, error: upErr.message }); continue; }
      summary.promoted++;
    } catch (e) {
      summary.errors.push({ pending_signup_id: su.id as string, error: e instanceof Error ? e.message : "unknown" });
    }
  }

  return summary;
}
