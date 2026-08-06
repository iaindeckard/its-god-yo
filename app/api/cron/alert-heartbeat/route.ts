import { NextResponse } from "next/server";
import { sendHeartbeatSms } from "@/lib/smsAlert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Tier 3 monthly heartbeat ("trust mechanism"): a single low-noise SMS proving the
 * emergency SMS pathway is alive, so the real emergency bar never has to be lowered
 * just to see it fire. No-op without OPS_ALERT_SMS_TO. Authorized by Vercel's cron
 * header or a CRON_SECRET bearer.
 */
export async function GET(req: Request) {
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";
  const secret = process.env.CRON_SECRET;
  const authed = isVercelCron || (!!secret && req.headers.get("authorization") === `Bearer ${secret}`);
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
