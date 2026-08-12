import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cronAuth";
import { runScheduledCampaigns } from "@/lib/outreach/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Poll for campaign-owned releases (Vercel Cron, see vercel.json).
 *
 * SAFE BY DEFAULT: this runs in DRY-RUN unless the send gate is fully open
 * (OUTREACH_COPY_APPROVED + OUTREACH_LEGAL_APPROVED + OUTREACH_SEND_LIVE all
 * "true" — see lib/outreach/config.ts). In dry-run it mints nothing and sends
 * nothing; it returns exactly who would be emailed. `?dry=1` forces dry-run even
 * when the gate is open (for a safe manual preview). There is no way to force a
 * LIVE send from the request — only the server-side env flags do that.
 *
 * Auth: a CRON_SECRET bearer (auto-sent by Vercel Cron) for manual/test runs.
 */
export async function GET(req: Request) {
  const authed = isAuthorizedCron(req);
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const reports = await runScheduledCampaigns();
    return NextResponse.json({ ok: true, campaigns_processed: reports.length, reports });
  } catch (e) {
    console.error("[outreach-send] failed:", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "send_failed" }, { status: 500 });
  }
}
