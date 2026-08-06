import { verifyTwilioSignature, normalizePhone } from "@/lib/twilio";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { sendSmsAlert, resolveSmsAlert, SMS_ALERT } from "@/lib/smsAlert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Twilio delivery-status webhook (Stage 2, spec step 5). Twilio POSTs a callback
 * for each outbound daily-send message (set via StatusCallback in lib/dailySend).
 * We advance daily_send_log.status by message_sid on the terminal outcomes
 * (delivered / undelivered / failed) and alert on failure. Interim statuses
 * (queued / sending / sent / accepted) are acked and ignored — the send path
 * already set 'sent' and stamped the cost row, so cost is NOT handled here.
 *
 * SAFE WHILE TWILIO IS PENDING: without TWILIO_AUTH_TOKEN set, returns 503 and
 * does nothing (can't process or be spoofed until real credentials exist).
 */
export async function POST(req: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return new Response("Twilio status not configured", { status: 503 });

  const raw = await req.text();
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw)) params[k] = v;

  const url = process.env.TWILIO_STATUS_URL || "https://its-god-yo.vercel.app/api/twilio/status";
  if (!verifyTwilioSignature(authToken, req.headers.get("x-twilio-signature"), url, params)) {
    return new Response("invalid signature", { status: 403 });
  }

  const sid = params.MessageSid || params.SmsSid || "";
  const status = (params.MessageStatus || params.SmsStatus || "").toLowerCase();

  // Only terminal outcomes advance the row; interim statuses are acked + ignored.
  const map: Record<string, string> = { delivered: "delivered", undelivered: "undelivered", failed: "failed" };
  const newStatus = sid ? map[status] : undefined;
  if (!newStatus) return new Response("", { status: 200 });

  const to = params.To ?? "";
  const patch: Record<string, unknown> = { status: newStatus, updated_at: new Date().toISOString() };
  if (status === "failed" || status === "undelivered") {
    patch.error = `twilio_${status}${params.ErrorCode ? ` code=${params.ErrorCode}` : ""}`;
    console.error(`[twilio/status][ALERT] ${status} sid=${sid} code=${params.ErrorCode ?? ""} to=${to}`);
  }

  try {
    await getSupabaseAdmin().from("daily_send_log").update(patch).eq("message_sid", sid);
  } catch (e) {
    // Ack to Twilio rather than 500-loop; log for diagnosis.
    console.error("[twilio/status] update error:", e instanceof Error ? e.message : e);
  }

  // Tier 3 trigger: a live subscriber's daily send failed outright (a real Twilio
  // delivery error, distinct from the routine no-content skip, which never sends
  // and so never lands here). Cooldown is scoped per recipient so one subscriber's
  // recurring failure doesn't mask a different subscriber's. A later delivered
  // status for the same number resolves it, so the next failure alerts promptly.
  //
  // Skip the ops-alert number itself: Tier 3 SMS are sent via the same sendSms path
  // (which sets this StatusCallback), so their own callbacks arrive here. They are
  // not subscriber sends — treating a failed alert to the ops phone as a subscriber
  // failure would be a false positive (and a self-referential loop).
  const opsTo = process.env.OPS_ALERT_SMS_TO;
  const isOpsNumber = !!opsTo && !!to && normalizePhone(to) === normalizePhone(opsTo);
  try {
    if (isOpsNumber) {
      /* ops-alert delivery receipt — not a subscriber send, ignore for Tier 3 */
    } else if (status === "failed" || status === "undelivered") {
      await sendSmsAlert({
        alertType: SMS_ALERT.SUBSCRIBER_SEND_FAILURE,
        entityKey: to,
        message: `Daily send ${status} to ${to}${params.ErrorCode ? ` (Twilio ${params.ErrorCode})` : ""}. A subscriber did not get their message.`,
        detail: `Twilio ${status} for sid=${sid}, to=${to}, code=${params.ErrorCode ?? "(none)"}. Check daily_send_log and Twilio logs.`,
      });
    } else if (status === "delivered" && to) {
      await resolveSmsAlert({ alertType: SMS_ALERT.SUBSCRIBER_SEND_FAILURE, entityKey: to });
    }
  } catch (e) {
    console.error("[twilio/status] tier3 alert error:", e instanceof Error ? e.message : e);
  }
  return new Response("", { status: 200 });
}
