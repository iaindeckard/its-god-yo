import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cronAuth";
import { runDailySend } from "@/lib/dailySend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stage 2 daily-send tick. Runs every 30 minutes (vercel.json: 0,30 * * * *).
 * Each run resolves who is due in their local timezone and sends that day's
 * approved verse exactly once. While DAILY_SEND_ENABLED (lib/flags.ts) is false
 * it runs DRY — computes everything, sends nothing, writes nothing. Pass
 * ?dry_run=1 to force a dry run even after it's enabled (manual inspection).
 * Auth matches the other crons: a CRON_SECRET bearer (auto-sent by Vercel Cron).
 */
export async function GET(req: Request) {
  // Require the CRON_SECRET bearer (isAuthorizedCron). Vercel injects
  // `Authorization: Bearer $CRON_SECRET` on real cron invocations, so the scheduler
  // passes while external requests spoofing the forgeable x-vercel-cron header
  // cannot trigger a send. This route sends SMS once enabled, so it must not rely on
  // a spoofable header.
  const authed = isAuthorizedCron(req);
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const dryRun = new URL(req.url).searchParams.get("dry_run") === "1";
  try {
    const summary = await runDailySend({ dryRun });
    return NextResponse.json(summary);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "daily_send_failed" }, { status: 500 });
  }
}
