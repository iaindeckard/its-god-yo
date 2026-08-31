import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cronAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { sendSms } from "@/lib/sms";
import { runClimaxSend } from "@/lib/seasons/climax";
import { SEASONS_ENABLED } from "@/lib/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Free climax-day send (Phase D). On the six climax days, sends the free climax
 * message to the entire active base, claiming the shared daily_send_log so a
 * subscriber gets exactly one message that day across all pipelines. No-ops on the
 * other ~359 days. Auth: a CRON_SECRET bearer (auto-sent by Vercel Cron). `?dry=1` to preview.
 */
export async function GET(req: Request) {
  const authed = isAuthorizedCron(req);
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!SEASONS_ENABLED) return NextResponse.json({ ok: true, skipped: "SEASONS_ENABLED=false" });

  const dry = new URL(req.url).searchParams.get("dry") === "1";
  const summary = await runClimaxSend({ db: getSupabaseAdmin(), nowMs: Date.now(), dryRun: dry, sendSms });
  return NextResponse.json({ ok: true, summary });
}
