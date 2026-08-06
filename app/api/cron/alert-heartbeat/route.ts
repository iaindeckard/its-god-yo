import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cronAuth";
import { sendHeartbeatSms } from "@/lib/smsAlert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Tier 3 monthly heartbeat ("trust mechanism"): a single low-noise SMS proving the
 * emergency SMS pathway is alive, so the real emergency bar never has to be lowered
 * just to see it fire. No-op without OPS_ALERT_SMS_TO. Authorized by a CRON_SECRET
 * bearer (auto-sent by Vercel Cron).
 */
export async function GET(req: Request) {
  const authed = isAuthorizedCron(req);
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const res = await sendHeartbeatSms();
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "heartbeat_failed";
    console.error("[alert-heartbeat] failed:", e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
