import { NextResponse } from "next/server";
import crypto from "crypto";
import { suppressByEmail } from "@/lib/outreach/leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resend event webhook (spec §2 — automated suppression). Hard bounces suppress
 * the address permanently (bounced_hard); spam complaints suppress as
 * unsubscribed. Soft/transient bounces are ignored (they retry). Idempotent:
 * suppressByEmail only moves rows that are still live.
 *
 * Signature: Resend uses Svix. We verify svix-id/svix-timestamp/svix-signature
 * against RESEND_WEBHOOK_SECRET (whsec_...). No secret => 503 (never trust
 * unsigned events).
 */
function verifySvix(secret: string, id: string, ts: string, body: string, sigHeader: string): boolean {
  const b64 = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let keyBytes: Buffer;
  try { keyBytes = Buffer.from(b64, "base64"); } catch { return false; }
  const expected = crypto.createHmac("sha256", keyBytes).update(`${id}.${ts}.${body}`).digest("base64");
  const expBuf = Buffer.from(expected);
  // Header is space-separated "v1,<sig> v1,<sig>"; accept if any matches.
  return sigHeader.split(" ").some((part) => {
    const sig = part.includes(",") ? part.split(",")[1] : part;
    const sigBuf = Buffer.from(sig || "");
    return sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
  });
}

interface ResendEvent {
  type?: string;
  data?: { to?: string[] | string; email?: string; bounce?: { type?: string } };
}

function recipients(data: ResendEvent["data"]): string[] {
  if (!data) return [];
  const to = data.to ?? data.email;
  if (Array.isArray(to)) return to;
  return to ? [to] : [];
}

export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "webhook_not_configured" }, { status: 503 });

  const id = req.headers.get("svix-id") ?? "";
  const ts = req.headers.get("svix-timestamp") ?? "";
  const sig = req.headers.get("svix-signature") ?? "";
  const raw = await req.text();
  if (!id || !ts || !sig || !verifySvix(secret, id, ts, raw, sig)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  let event: ResendEvent;
  try { event = JSON.parse(raw) as ResendEvent; } catch { return NextResponse.json({ error: "bad_json" }, { status: 400 }); }

  const emails = recipients(event.data);
  let suppressed = 0;
  try {
    if (event.type === "email.bounced") {
      const bounceType = event.data?.bounce?.type ?? "";
      // Only hard/permanent bounces suppress; soft/transient bounces retry.
      if (/perman|hard/i.test(bounceType)) {
        for (const e of emails) suppressed += await suppressByEmail(e, "bounced_hard", `resend:${bounceType}`);
      }
    } else if (event.type === "email.complained") {
      for (const e of emails) suppressed += await suppressByEmail(e, "unsubscribed", "spam_complaint");
    }
  } catch (e) {
    console.error("[resend-webhook] suppression error:", e);
    return NextResponse.json({ error: "handler_error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, type: event.type, suppressed });
}
