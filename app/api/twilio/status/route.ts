import { verifyTwilioSignature } from "@/lib/twilio";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

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

  const patch: Record<string, unknown> = { status: newStatus, updated_at: new Date().toISOString() };
  if (status === "failed" || status === "undelivered") {
    patch.error = `twilio_${status}${params.ErrorCode ? ` code=${params.ErrorCode}` : ""}`;
    console.error(`[twilio/status][ALERT] ${status} sid=${sid} code=${params.ErrorCode ?? ""} to=${params.To ?? ""}`);
  }

  try {
    await getSupabaseAdmin().from("daily_send_log").update(patch).eq("message_sid", sid);
  } catch (e) {
    // Ack to Twilio rather than 500-loop; log for diagnosis.
    console.error("[twilio/status] update error:", e instanceof Error ? e.message : e);
  }
  return new Response("", { status: 200 });
}
