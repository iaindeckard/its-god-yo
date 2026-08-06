import "server-only";
import { getSupabaseAdmin } from "./supabaseAdmin";
import { sendSms } from "./dailySend";
import { sendOpsAlert } from "./opsAlert";
import { claimAlert, resolveAlert, SMS_COOLDOWN_MS } from "./alertState";

/**
 * Tier 3 of the task-notification system (LOCKED spec + cooldown addendum
 * 2026-08-06): SMS for true emergencies only, deliberately rare so it stays
 * meaningful. A 4-hour cooldown per (alert_type + affected entity) prevents a
 * stuck issue from re-texting on every cron tick; the cooldown resets on
 * resolution so a genuinely new occurrence isn't muffled by a stale window.
 * (All cooldown/resolution state lives in igy_alert_state via lib/alertState.)
 *
 * Recipient: OPS_ALERT_SMS_TO (E.164). Without it we no-op (like the ops-alert
 * email no-op'ing without RESEND_API_KEY) so nothing breaks before it is set.
 *
 * Delivery uses the SAME lib/dailySend.sendSms path as subscriber messages. If the
 * SMS fails to send — notably the twilio_account alert, where the very channel is
 * the thing that is down — we fall back to the ops-alert EMAIL so the signal is
 * never silently lost, and still respect the cooldown (the signal was delivered).
 */

/** The four locked emergency classes. Passed as `alertType`; callers may use these
 *  constants so entity-scoped cooldowns line up across call sites. */
export const SMS_ALERT = {
  SUBSCRIBER_SEND_FAILURE: "subscriber_send_failure",
  STRIPE_WEBHOOK_GAP: "stripe_webhook_gap",
  TWILIO_ACCOUNT: "twilio_account",
  SECURITY_EVENT: "security_event",
} as const;

export type SmsAlertResult =
  | { sent: true; via: "sms" }
  | { sent: false; via: "email_fallback" }
  | { sent: false; reason: "suppressed" | "no_recipient" | "email_fallback_failed" };

/**
 * Fire a Tier 3 SMS for an emergency, subject to the 4h per-entity cooldown.
 * entityKey scopes the suppression to the specific recurring issue (e.g. one
 * subscriber's phone, or "webhook") so a different entity's failure still alerts.
 */
export async function sendSmsAlert(args: {
  alertType: string;
  entityKey?: string;
  /** Short human line — becomes the SMS body after the "IGY ALERT:" prefix. */
  message: string;
  /** Longer context used only in the email fallback (defaults to `message`). */
  detail?: string;
  db?: ReturnType<typeof getSupabaseAdmin>;
}): Promise<SmsAlertResult> {
  const db = args.db ?? getSupabaseAdmin();
  const to = process.env.OPS_ALERT_SMS_TO;
  if (!to) {
    console.warn(`[sms-alert] OPS_ALERT_SMS_TO not set — "${args.alertType}" not texted: ${args.message}`);
    return { sent: false, reason: "no_recipient" };
  }

  const fire = await claimAlert(db, {
    alertType: args.alertType,
    entityKey: args.entityKey,
    cooldownMs: SMS_COOLDOWN_MS,
    message: args.message,
  });
  if (!fire) {
    console.warn(`[sms-alert] suppressed by cooldown: ${args.alertType}/${args.entityKey ?? ""}`);
    return { sent: false, reason: "suppressed" };
  }

  const body = `IGY ALERT: ${args.message}`;
  try {
    await sendSms(to, body);
    console.error(`[sms-alert][SENT] ${args.alertType}/${args.entityKey ?? ""}: ${args.message}`);
    return { sent: true, via: "sms" };
  } catch (e) {
    // SMS path itself failed (very possibly the emergency IS Twilio). Fall back to
    // email so the alert is not lost; keep the claim so cooldown still holds.
    console.error(`[sms-alert] SMS send failed for ${args.alertType}, falling back to email:`, e instanceof Error ? e.message : e);
    try {
      await sendOpsAlert({
        subject: `🚨 IGY EMERGENCY (SMS undeliverable): ${args.alertType}`,
        text:
          `Tier 3 SMS alert could NOT be sent (the SMS channel itself may be down):\n\n${args.detail ?? args.message}\n\n` +
          `Alert: ${args.alertType} · entity: ${args.entityKey ?? "(none)"}\n` +
          `SMS error: ${e instanceof Error ? e.message : String(e)}`,
      });
      return { sent: false, via: "email_fallback" };
    } catch (e2) {
      console.error(`[sms-alert] email fallback ALSO failed for ${args.alertType}:`, e2 instanceof Error ? e2.message : e2);
      return { sent: false, reason: "email_fallback_failed" };
    }
  }
}

/**
 * Mark a Tier 3 condition resolved so the next occurrence fires immediately
 * instead of waiting out the 4h window. Call when the underlying issue clears
 * (e.g. a subsequent successful send for a subscriber, a clean reconcile run).
 */
export async function resolveSmsAlert(args: {
  alertType: string;
  entityKey?: string;
  db?: ReturnType<typeof getSupabaseAdmin>;
}): Promise<void> {
  const db = args.db ?? getSupabaseAdmin();
  const cleared = await resolveAlert(db, { alertType: args.alertType, entityKey: args.entityKey });
  if (cleared) console.error(`[sms-alert][RESOLVED] ${args.alertType}/${args.entityKey ?? ""}`);
}

/**
 * Monthly heartbeat (spec "trust mechanism"): a low-noise text proving the SMS
 * pathway is alive without lowering the real emergency bar. Not cooldown-gated —
 * the monthly cron schedule is its cadence. No-op without a recipient.
 */
export async function sendHeartbeatSms(): Promise<{ sent: boolean; sid?: string; segments?: number | null; reason?: string }> {
  const to = process.env.OPS_ALERT_SMS_TO;
  if (!to) {
    console.warn("[sms-alert] OPS_ALERT_SMS_TO not set — heartbeat not sent");
    return { sent: false, reason: "no_recipient" };
  }
  const { sid, segments } = await sendSms(to, "IGY alert system check, no action needed.");
  console.error(`[sms-alert][HEARTBEAT] sent sid=${sid}`);
  return { sent: true, sid, segments };
}
