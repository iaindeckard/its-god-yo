import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cronAuth";
import { computeDailyClose, localDateStr } from "@/lib/donationFund";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Daily close-of-business job (Vercel Cron, see vercel.json). Computes the
 * donation-fund close for the just-ended business day: net profit from exact
 * Stripe fees, the day's precise share of flat recurring costs, real Twilio
 * usage, and one-time costs; adds 10% of a positive net to the reserved fund
 * (loss days add $0). Idempotent per day.
 *
 * Auth: a CRON_SECRET bearer (auto-sent by Vercel Cron) for manual/test runs.
 * Optional ?date=YYYY-MM-DD to (re)close a specific local day (backfill/verify);
 * default is yesterday in America/Chicago.
 */
export async function GET(req: Request) {
  const authed = isAuthorizedCron(req);
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const date = url.searchParams.get("date") || localDateStr(-1); // default: yesterday (Chicago)

  try {
    const close = await computeDailyClose(date);
    return NextResponse.json({ ok: true, close });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "close_failed" }, { status: 500 });
  }
}
