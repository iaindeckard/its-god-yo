import { verifyTwilioSignature } from "@/lib/twilio";
import { processInboundReply } from "@/lib/twilioInbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Inbound Twilio SMS webhook — the real "YES" handler that replaces the internal
 * confirm-signup stand-in. YES confirms the recipient's consent row and, once
 * every consent row on the parent signup is confirmed, creates the (trialing)
 * subscription. STOP opts out and cancels the pending signup. Nothing is charged
 * here: createSubscription starts a 7-day trial from this moment.
 *
 * SAFE WHILE TWILIO IS PENDING: without TWILIO_AUTH_TOKEN set, this returns 503
 * and does nothing — so deploying now can't process (or let anyone spoof)
 * anything until real Twilio credentials + a verified sender exist.
 */

function twiml(message?: string) {
  const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]!));
  const inner = message ? `<Message>${esc(message)}</Message>` : "";
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

export async function POST(req: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  // Twilio not configured yet -> do nothing (safe while verification is pending).
  if (!authToken) return new Response("Twilio inbound not configured", { status: 503 });

  const raw = await req.text();
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw)) params[k] = v;

  const url = process.env.TWILIO_INBOUND_URL || "https://its-god-yo.vercel.app/api/twilio/inbound";
  if (!verifyTwilioSignature(authToken, req.headers.get("x-twilio-signature"), url, params)) {
    return new Response("invalid signature", { status: 403 });
  }

  const from = params.From || "";
  const body = params.Body || "";
  if (!from) return twiml();

  try {
    const result = await processInboundReply(from, body);
    return twiml(result.reply);
  } catch (e) {
    // Ack to Twilio rather than 500-looping on a logic bug; log for diagnosis.
    console.error("[twilio/inbound] error:", e instanceof Error ? e.message : e);
    return twiml();
  }
}
