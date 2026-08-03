import { NextResponse } from "next/server";
import { runPreorderTimeouts } from "@/lib/preorder/timeouts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Daily preorder timeout sweep (spec steps 3 + 5). For is_preorder rows it sends
 * the one-shot 3-day reminders and removes rows past the 7-day cutoff (PII scrub +
 * Stripe customer delete + removed_signups stub). Idempotent: reminder one-shots
 * are guarded by their *_reminder_sent_at stamps and removal skips already-removed
 * rows. Authorized by Vercel's cron header or a CRON_SECRET bearer.
 *
 * `?dry=1` reports what WOULD happen without sending or mutating anything.
 */
export async function GET(req: Request) {
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";
  const secret = process.env.CRON_SECRET;
  const authed = isVercelCron || (!!secret && req.headers.get("authorization") === `Bearer ${secret}`);
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const dry = new URL(req.url).searchParams.get("dry") === "1";
  const summary = await runPreorderTimeouts(dry);
  return NextResponse.json({ ok: true, summary });
}
