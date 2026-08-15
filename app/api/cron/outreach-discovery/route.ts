import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cronAuth";
import { runDiscovery } from "@/lib/outreach/discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Monthly church-outreach discovery (Vercel Cron, see vercel.json). Runs the
 * guardrailed OpenAI web-search pass and upserts new leads into
 * igy_outreach_leads (never resurrecting a suppressed org). Read/discovery only
 * — this NEVER sends email. Auth: a CRON_SECRET bearer (auto-sent by Vercel Cron)
 * for manual/test runs.
 */
export async function GET(req: Request) {
  const authed = isAuthorizedCron(req);
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const result = await runDiscovery();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[outreach-discovery] failed:", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "discovery_failed" }, { status: 500 });
  }
}
