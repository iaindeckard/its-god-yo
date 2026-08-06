import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cronAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { makePoolVerseSelector, runSeasonGeneration } from "@/lib/seasons/content";
import { SEASONS_ENABLED } from "@/lib/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Daily T-30 season-content generation trigger (Phase C). For any season whose
 * review window has opened (≤30 days to start) and has no batch yet, generates the
 * batch (in_review) using the real get_theme_track_pool selector. Idempotent.
 * Authorized by a CRON_SECRET bearer (auto-sent by Vercel Cron).
 */
export async function GET(req: Request) {
  const authed = isAuthorizedCron(req);
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!SEASONS_ENABLED) return NextResponse.json({ ok: true, skipped: "SEASONS_ENABLED=false" });

  const now = new Date();
  const today = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() };
  const db = getSupabaseAdmin();
  const selectVerse = await makePoolVerseSelector(db);
  const { generated } = await runSeasonGeneration({ db, today, selectVerse });
  return NextResponse.json({ ok: true, today, generated });
}
