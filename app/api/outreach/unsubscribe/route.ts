import { NextResponse } from "next/server";
import { verifyUnsubToken } from "@/lib/outreach/email";
import { getLead, suppressByEmail } from "@/lib/outreach/leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One-click unsubscribe (spec §2, RFC 8058). Public + token-gated so it can't be
 * forged or enumerated. Suppression is PERMANENT and real-time: the lead flips to
 * 'unsubscribed' immediately and, because the discovery upsert never resurrects a
 * known email, that org can never be re-added or re-mailed.
 *
 * POST = the mail client's List-Unsubscribe-Post one-click call (no body needed).
 * GET  = the visible link in the email body; shows a small confirmation page.
 */
async function unsubscribe(leadId: string, token: string): Promise<{ ok: boolean; org?: string }> {
  if (!leadId || !verifyUnsubToken(leadId, token)) return { ok: false };
  const lead = await getLead(leadId);
  if (!lead) return { ok: false };
  await suppressByEmail(lead.contact_email, "unsubscribed"); // idempotent
  return { ok: true, org: lead.org_name };
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const { ok } = await unsubscribe(url.searchParams.get("lead") ?? "", url.searchParams.get("t") ?? "");
  // One-click clients expect a fast 2xx; 200 even on a no-op keeps it idempotent.
  return ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ ok: false, error: "invalid_or_expired_link" }, { status: 400 });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const { ok, org } = await unsubscribe(url.searchParams.get("lead") ?? "", url.searchParams.get("t") ?? "");
  const body = ok
    ? `<h1>You're unsubscribed</h1><p>${org ? org : "Your organization"} won't receive any further outreach from It's God, Yo. Sorry for the interruption — thanks for the work you do.</p>`
    : `<h1>Link not valid</h1><p>This unsubscribe link is invalid or has expired. If you'd still like to opt out, just reply to the email and a person will handle it.</p>`;
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe · It's God, Yo</title><div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:64px auto;padding:0 20px;color:#1a1a1a;line-height:1.55;">${body}</div>`,
    { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
