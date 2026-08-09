import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cronAuth";
import { DM_UPSELL_ENABLED } from "@/lib/flags";
import { runDmUpsell } from "@/lib/dmUpsell";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Day-14-21 "DM from Him" retention upsell. Runs daily. Finds live subscribers
 * (individual/gift, v1) without the DM add-on whose subscription_created_at is
 * 14-21 days old, and sends each a one-time cross-sell SMS. Exactly-once via
 * dm_upsell_log (see lib/dmUpsell).
 *
 * DRY by default: sends real SMS only when DM_UPSELL_ENABLED is true. While the
 * flag is false the run still computes + reports who WOULD be prompted but sends
 * nothing and writes no dm_upsell_log rows. `?dry=1` forces dry-run even when the
 * flag is on (for a safe manual preview).
 *
 * Auth: CRON_SECRET bearer (auto-sent by Vercel Cron), same as every other cron.
 */
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const dryParam = new URL(req.url).searchParams.get("dry") === "1";
  const dryRun = dryParam || !DM_UPSELL_ENABLED;
  try {
    const summary = await runDmUpsell({ dryRun });
    return NextResponse.json({ ok: true, flag_enabled: DM_UPSELL_ENABLED, ...summary });
  } catch (e) {
    console.error("[dm-upsell] run_failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
