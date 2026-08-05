import { NextResponse } from "next/server";
import { sendOpsAlert } from "@/lib/opsAlert";
import { OPENER_POOL_LIVE_DATE } from "@/lib/dmOpeners";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Monthly nudge (vercel.json: 0 13 1 * *): when the DM-from-Him opener pool nears
 * a yearly anniversary of going live, fire the shared ops-alert so a human reviews
 * the 130 lines (refresh / retire / expand). Notify only, never auto-regenerates.
 * Authorized by Vercel's cron header or the CRON_SECRET bearer.
 */
export async function GET(req: Request) {
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";
  const secret = process.env.CRON_SECRET;
  const authed = isVercelCron || (!!secret && req.headers.get("authorization") === `Bearer ${secret}`);
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const live = new Date(`${OPENER_POOL_LIVE_DATE}T00:00:00Z`);
  const now = new Date();
  // Next anniversary at or after today.
  const anniversary = new Date(Date.UTC(now.getUTCFullYear(), live.getUTCMonth(), live.getUTCDate()));
  if (anniversary.getTime() < Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) {
    anniversary.setUTCFullYear(anniversary.getUTCFullYear() + 1);
  }
  const daysUntil = Math.round((anniversary.getTime() - now.getTime()) / 86_400_000);
  const yearsLive = anniversary.getUTCFullYear() - live.getUTCFullYear();

  // Fire once in the ~monthly window before each anniversary (>= 1 year old).
  if (yearsLive >= 1 && daysUntil <= 31) {
    await sendOpsAlert({
      subject: `Time to review the DM from Him opener pool (${yearsLive} yr)`,
      text:
        `The DM-from-Him opener pool went live on ${OPENER_POOL_LIVE_DATE} and reaches its ` +
        `${yearsLive}-year mark on ${anniversary.toISOString().slice(0, 10)} (about ${daysUntil} days out).\n\n` +
        `Please review the 130 lines in lib/dmOpeners.ts: refresh stale phrasing, retire any that no longer land, ` +
        `or expand the pool. Nothing regenerates automatically. When you refresh, bump OPENER_POOL_LIVE_DATE.`,
    });
    return NextResponse.json({ alerted: true, daysUntil, yearsLive });
  }
  return NextResponse.json({ alerted: false, daysUntil, yearsLive });
}
