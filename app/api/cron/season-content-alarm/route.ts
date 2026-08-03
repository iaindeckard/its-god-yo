import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { sendOpsAlert } from "@/lib/opsAlert";
import { runSeasonReviewAlarm, type SeasonReviewAlert } from "@/lib/seasons/content";
import { SEASONS_ENABLED } from "@/lib/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Daily T-14 season content-review alarm (Phase C). For any season batch not yet
 * approved whose season starts within 14 days, fires the shared ops-alert (Resend)
 * once. Authorized by Vercel's cron header or CRON_SECRET bearer.
 */
export async function GET(req: Request) {
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";
  const secret = process.env.CRON_SECRET;
  const authed = isVercelCron || (!!secret && req.headers.get("authorization") === `Bearer ${secret}`);
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!SEASONS_ENABLED) return NextResponse.json({ ok: true, skipped: "SEASONS_ENABLED=false" });

  const now = new Date();
  const today = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() };
  const sendAlert = (a: SeasonReviewAlert) =>
    sendOpsAlert({
      subject: `⚠️ Season content NOT approved — ${a.season} ${a.seasonYear} (${a.daysUntilStart}d to start)`,
      text:
        `The ${a.season} ${a.seasonYear} content batch is not fully approved: ${a.approved}/${a.total} items approved, ` +
        `${a.daysUntilStart} days until the season starts (the pre-season charge fires on approval only).\n\n` +
        `Finish review in /admin before the charge window — Tables: season_content_batches · season_content_items.`,
    });

  const { tripped } = await runSeasonReviewAlarm({ db: getSupabaseAdmin(), today, sendAlert });
  return NextResponse.json({ ok: true, today, tripped });
}
