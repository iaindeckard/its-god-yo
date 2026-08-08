import { NextResponse } from "next/server";
import crypto from "crypto";
import { suppressByEmail, findLeadByContactEmail } from "@/lib/outreach/leads";
import { recordActionItem } from "@/lib/actionItems";

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

type EmailAddr = string | { email?: string; address?: string; name?: string };

interface ResendEvent {
  type?: string;
  data?: {
    to?: EmailAddr[] | EmailAddr;
    email?: string;
    bounce?: { type?: string };
    // email.received fields
    from?: EmailAddr;
    subject?: string;
    email_id?: string;
    message_id?: string;
    cc?: EmailAddr[] | EmailAddr;
    bcc?: EmailAddr[] | EmailAddr;
    // Resend's inbound payload reports the actual delivery recipient(s) (envelope /
    // Received-header) here — for a Bcc'd message the header `to` is hello@ but
    // `received_for` (and/or bcc) carries our capture@reply.itsgodyo.com address.
    received_for?: EmailAddr[] | EmailAddr;
  };
}

/** All addresses in a to/cc/bcc/received_for value, normalized + lowercased. */
function addrList(v: EmailAddr[] | EmailAddr | undefined | null): string[] {
  if (!v) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.map((x) => firstEmailAddr(x)).filter((s): s is string => !!s);
}

function recipients(data: ResendEvent["data"]): string[] {
  if (!data) return [];
  const to = data.to ?? data.email;
  const list = Array.isArray(to) ? to : to ? [to] : [];
  return list.map((a) => firstEmailAddr(a)).filter((s): s is string => !!s);
}

/** Pull a bare lowercased address out of the many shapes Resend may send
 *  ("Name <a@b>", {email}, {address}, arrays). */
function firstEmailAddr(v: EmailAddr | EmailAddr[] | undefined | null): string | null {
  if (!v) return null;
  if (Array.isArray(v)) {
    for (const x of v) { const e = firstEmailAddr(x); if (e) return e; }
    return null;
  }
  if (typeof v === "object") return firstEmailAddr(v.email ?? v.address ?? null);
  const m = v.match(/<([^>]+)>/);
  const raw = (m ? m[1] : v).trim().toLowerCase();
  return raw.includes("@") ? raw : null;
}

/** Best-effort display name from a "from" value ("Name <a@b>" or {name}). */
function fromName(v: EmailAddr | undefined): string | null {
  if (!v) return null;
  if (typeof v === "object") return v.name ?? null;
  const m = v.match(/^\s*"?([^"<]+?)"?\s*</);
  return m ? m[1].trim() : null;
}

/** Address (localpart@)domain of the Resend receiving subdomain that the M365 Bcc
 *  rule and the outreach Reply-To point at. Only inbound delivered here is treated
 *  as an outreach reply. */
const CAPTURE_DOMAIN = (process.env.OUTREACH_REPLY_CAPTURE_DOMAIN || "reply.itsgodyo.com").toLowerCase();

/** Subjects that are machine noise, not a human reply — don't nag on these. */
const NON_REPLY_SUBJECT =
  /^(auto(matic)?[ -]?reply|out of office|undeliverable|delivery status|mail delivery|read:|declined:|accepted:|canceled:)/i;

/**
 * Handle an inbound outreach reply (email.received). Scope §1: we only act when the
 * mail was delivered to our capture subdomain (the M365 Bcc rule only copies genuine
 * replies to hello@ there, and the agent's Reply-To routes there), and we skip
 * autoresponders/bounces by subject + sender. We store NO body (§3) — just enough
 * metadata to say "X replied, go read it," and surface it as an action item. Match
 * the sender to a lead so the notification can name the org; unknown senders (manual
 * outreach, or a reply from a different address) still get flagged generically.
 * Best-effort: never throw, so a match miss can't wedge the webhook.
 */
async function handleInboundReply(data: ResendEvent["data"]): Promise<boolean> {
  if (!data) return false;
  // Was this actually delivered to our capture subdomain? Check every recipient
  // surface, not just the header `to`: a Bcc'd manual reply carries hello@ in `to`
  // and capture@reply.itsgodyo.com only in `received_for`/`bcc`.
  const rcpts = [
    ...addrList(data.to),
    ...addrList(data.cc),
    ...addrList(data.bcc),
    ...addrList(data.received_for),
  ];
  const forUs = rcpts.some((a) => a.endsWith(`@${CAPTURE_DOMAIN}`));
  if (!forUs) return false; // inbound to some other address we happen to receive — ignore

  const sender = firstEmailAddr(data.from);
  if (!sender) return false;
  const subject = (data.subject ?? "").trim();
  if (NON_REPLY_SUBJECT.test(subject)) return false;
  if (/^(mailer-daemon|postmaster|no-?reply|do-?not-?reply)@/i.test(sender)) return false;

  const lead = await findLeadByContactEmail(sender).catch(() => null);
  const who = lead?.org_name || fromName(data.from) || sender;
  await recordActionItem({
    kind: "outreach_reply",
    // One open item per sender — repeated replies from the same person while it's
    // still open collapse into the single "go read it" nudge.
    dedupeKey: `outreach_reply:${sender}`,
    title: `Reply from ${who}`,
    detail: subject ? `Re: "${subject}". Go check your inbox.` : "A reply came in. Go check your inbox.",
    metadata: {
      from_email: sender,
      from_name: fromName(data.from),
      subject: subject || null,
      lead_id: lead?.id ?? null,
      source: lead ? "outreach_lead" : "manual",
      resend_email_id: data.email_id ?? null,
      message_id: data.message_id ?? null,
    },
  });
  return true;
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
  let replyFlagged = false;
  try {
    if (event.type === "email.bounced") {
      const bounceType = event.data?.bounce?.type ?? "";
      // Only hard/permanent bounces suppress; soft/transient bounces retry.
      if (/perman|hard/i.test(bounceType)) {
        for (const e of emails) suppressed += await suppressByEmail(e, "bounced_hard", `resend:${bounceType}`);
      }
    } else if (event.type === "email.complained") {
      for (const e of emails) suppressed += await suppressByEmail(e, "unsubscribed", "spam_complaint");
    } else if (event.type === "email.received") {
      replyFlagged = await handleInboundReply(event.data);
    }
  } catch (e) {
    console.error("[resend-webhook] handler error:", e);
    return NextResponse.json({ error: "handler_error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, type: event.type, suppressed, replyFlagged });
}
