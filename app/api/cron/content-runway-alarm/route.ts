import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { sendOpsAlert } from "@/lib/opsAlert";
import { runContentRunwayAlarm, RUNWAY_THRESHOLD_DAYS, type TrackRunway } from "@/lib/contentRunway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Tier 2 daily content-runway alarm. For any daily-cadence track whose furthest
 * approved scheduled_date drops under RUNWAY_THRESHOLD_DAYS of runway, emails Iain
 * once per episode via the shared ops-alert channel (dedup + recovery handled in
 * lib/contentRunway via igy_alert_state). Authorized by Vercel's cron header or a
 * CRON_SECRET bearer. ?days=N overrides the threshold (manual/test runs).
 */
export async function GET(req: Request) {
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";
  const secret = process.env.CRON_SECRET;
  const authed = isVercelCron || (!!secret && req.headers.get("authorization") === `Bearer ${secret}`);
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const thresholdDays = Math.max(1, Number(url.searchParams.get("days")) || RUNWAY_THRESHOLD_DAYS);
  const todayIso = new Date().toISOString().slice(0, 10);

  const line = (t: TrackRunway) =>
    t.runwayDays === null
      ? `  • ${t.label} (${t.track}) — NO upcoming approved content`
      : `  • ${t.label} (${t.track}) — ${t.runwayDays} day(s) left, through ${t.furthestApproved}`;

  const sendAlert = async (tripped: TrackRunway[]) =>
    sendOpsAlert({
      subject: `⚠️ IGY content runway low — ${tripped.length} track(s) under ${thresholdDays}d`,
      text:
        `These daily-cadence tracks are running low on approved content ` +
        `(under ${thresholdDays} days of runway as of ${todayIso}):\n\n` +
        `${tripped.map(line).join("\n")}\n\n` +
        `Approve more verses in /admin/review (and stage tags in /admin/theme-tags) before ` +
        `daily-send starts skipping for no content. This alert fires once per track per ` +
        `episode and clears automatically once the track's runway recovers.\n\n` +
        `Tables: daily_slots (status='approved') · theme_tracks`,
    });

  try {
    const { tripped, alerted } = await runContentRunwayAlarm({ db: getSupabaseAdmin(), todayIso, sendAlert, thresholdDays });
    return NextResponse.json({
      ok: true,
      today: todayIso,
      threshold_days: thresholdDays,
      tripped: tripped.map((t) => ({ track: t.track, runway_days: t.runwayDays, through: t.furthestApproved })),
      emailed: alerted.map((t) => t.track),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "content_runway_failed";
    console.error("[content-runway] run failed:", e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
