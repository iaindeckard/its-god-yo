import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { computeDailyClose, localDateStr } from "@/lib/donationFund";

export const dynamic = "force-dynamic";

/**
 * Manually run (or re-run) the daily close for a given local date — for
 * backfill and for verifying the calculation. Idempotent. The scheduled Vercel
 * cron does the same thing automatically each morning for the prior day.
 */
export async function POST(req: Request) {
  try {
    await requirePermission("finance.donation_fund.disburse");
    const body = await req.json().catch(() => ({}));
    const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : localDateStr(-1);
    const close = await computeDailyClose(date);
    return NextResponse.json({ close });
  } catch (e) {
    return apiError(e);
  }
}
