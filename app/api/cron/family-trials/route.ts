import { NextResponse } from "next/server";
import { reconcileAllFamilies } from "@/lib/familyBilling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Scheduled job (Vercel Cron, see vercel.json) that reconciles every active
 * Family purchase's extra-teen quantity — picking up teens whose own 7-day trial
 * has just elapsed and adding their $28 (prorated) at that point. Idempotent.
 * Authorized either by Vercel's cron header or a CRON_SECRET bearer (for manual
 * / test invocation).
 */
export async function GET(req: Request) {
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";
  const secret = process.env.CRON_SECRET;
  const authed = isVercelCron || (!!secret && req.headers.get("authorization") === `Bearer ${secret}`);
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const reconciled = await reconcileAllFamilies();
  return NextResponse.json({ ok: true, count: reconciled.length, reconciled });
}
