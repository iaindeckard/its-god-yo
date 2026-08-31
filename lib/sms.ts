import "server-only";

/**
 * Shared outbound-SMS sender (Twilio REST). Extracted verbatim from lib/dailySend so
 * the daily-send path, the SMS ops-alerts, the DM upsell, seasonal climax sends, and
 * the Christmas gift release cron all send through ONE function rather than parallel
 * copies. The request shape (URL, auth, form fields, StatusCallback wiring) is unchanged
 * from the original dailySend definition.
 */
export async function sendSms(to: string, body: string): Promise<{ sid: string; segments: number | null }> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!accountSid || !token || !from) throw new Error("twilio_not_configured");
  const form: Record<string, string> = { From: from, To: to, Body: body };
  // Point Twilio at the delivery-status webhook so /api/twilio/status can advance
  // daily_send_log (sent -> delivered/undelivered/failed) and alert on failure.
  const statusUrl = process.env.TWILIO_STATUS_URL
    || (process.env.NEXT_PUBLIC_SITE_URL ? `${process.env.NEXT_PUBLIC_SITE_URL}/api/twilio/status` : "");
  if (statusUrl) form.StatusCallback = statusUrl;
  const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${accountSid}:${token}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(form).toString(),
  });
  const data = await resp.json().catch(() => ({} as Record<string, unknown>));
  if (!resp.ok) throw new Error(`twilio_${resp.status}: ${String((data as { message?: string })?.message ?? "").slice(0, 140)}`);
  const numSeg = (data as { num_segments?: string | number }).num_segments;
  return { sid: String((data as { sid?: string }).sid ?? ""), segments: numSeg != null ? Number(numSeg) : null };
}
