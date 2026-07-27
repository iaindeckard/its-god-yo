import { NextResponse } from "next/server";
import { runDiscovery } from "@/lib/outreach/discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Monthly church-outreach discovery (Vercel Cron, see vercel.json). Runs the
 * guardrailed Claude web-search pass and upserts new leads into
 * igy_outreach_leads (never resurrecting a suppressed org). Read/discovery only
 * — this NEVER sends email. Auth: Vercel's cron header, or a CRON_SECRET bearer
 * for manual/test runs.
 */
export async function GET(req: Request) {
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";
  const secret = process.env.CRON_SECRET;
  const authed = isVercelCron || (!!secret && req.headers.get("authorization") === `Bearer ${secret}`);
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const result = await runDiscovery();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[outreach-discovery] failed:", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "discovery_failed" }, { status: 500 });
  }
}
