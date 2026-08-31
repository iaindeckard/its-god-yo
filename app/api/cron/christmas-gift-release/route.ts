import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cronAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { runChristmasGiftRelease } from "@/lib/christmasGiftRelease";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Christmas Scheduled Gift 2026 release-day cron (daily). Sends due confirmation texts,
 * the day-7 reminder, converts unconfirmed gifts to account credit at day 30, and
 * deactivates gifted years that have ended. Auth via CRON_SECRET bearer (Vercel Cron).
 * ?dry=1 computes counts without sending or writing.
 */
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const dry = new URL(req.url).searchParams.get("dry") === "1";
  const summary = await runChristmasGiftRelease({ admin: getSupabaseAdmin(), nowMs: Date.now(), dryRun: dry });
  return NextResponse.json({ ok: true, ...summary });
}
