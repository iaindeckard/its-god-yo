import { NextResponse } from "next/server";
import { runSend } from "@/lib/outreach/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Monthly church-outreach send (Vercel Cron, see vercel.json).
 *
 * SAFE BY DEFAULT: this runs in DRY-RUN unless the send gate is fully open
 * (OUTREACH_COPY_APPROVED + OUTREACH_LEGAL_APPROVED + OUTREACH_SEND_LIVE all
 * "true" — see lib/outreach/config.ts). In dry-run it mints nothing and sends
 * nothing; it returns exactly who would be emailed. `?dry=1` forces dry-run even
 * when the gate is open (for a safe manual preview). There is no way to force a
 * LIVE send from the request — only the server-side env flags do that.
 *
 * Auth: Vercel's cron header, or a CRON_SECRET bearer for manual/test runs.
 */
export async function GET(req: Request) {
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";
  const secret = process.env.CRON_SECRET;
  const authed = isVercelCron || (!!secret && req.headers.get("authorization") === `Bearer ${secret}`);
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const forceDry = new URL(req.url).searchParams.get("dry") === "1";
  try {
    const report = await runSend(forceDry);
    return NextResponse.json({ ok: true, report });
  } catch (e) {
    console.error("[outreach-send] failed:", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "send_failed" }, { status: 500 });
  }
}
