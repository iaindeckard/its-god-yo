import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cronAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getStripe } from "@/lib/stripe";
import { runSeasonBilling } from "@/lib/seasons/billing";
import { SEASONS_ENABLED } from "@/lib/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Daily moving-date season-billing sweep (Phase B). For each active auto-renew
 * season enrollment whose season starts in a few days, charges the saved card
 * off-session — once per season per year (claim-first idempotency + Stripe
 * idempotencyKey), and only if that season's content batch is `approved`.
 * No-ops for every enrollment outside its charge window. Authorized by a
 * CRON_SECRET bearer (auto-sent by Vercel Cron). `?dry=1` reports without charging.
 */
export async function GET(req: Request) {
  const authed = isAuthorizedCron(req);
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!SEASONS_ENABLED) return NextResponse.json({ ok: true, skipped: "SEASONS_ENABLED=false" });

  const dry = new URL(req.url).searchParams.get("dry") === "1";
  const now = new Date();
  const today = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() };
  const results = await runSeasonBilling({ db: getSupabaseAdmin(), stripe: getStripe(), today, dryRun: dry });
  return NextResponse.json({ ok: true, today, dry, results });
}
