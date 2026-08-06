import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cronAuth";
import { reconcileAllFamilies } from "@/lib/familyBilling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Scheduled job (Vercel Cron, see vercel.json) that reconciles every active
 * Family purchase's extra-teen quantity — picking up teens whose own 7-day trial
 * has just elapsed and adding their $28 (prorated) at that point. Idempotent.
 * Authorized either by a CRON_SECRET bearer (auto-sent by Vercel Cron) (for manual
 * / test invocation).
 */
export async function GET(req: Request) {
  const authed = isAuthorizedCron(req);
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const reconciled = await reconcileAllFamilies();
  return NextResponse.json({ ok: true, count: reconciled.length, reconciled });
}
