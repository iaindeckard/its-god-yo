import { NextRequest, NextResponse } from "next/server";
import { FREEMIUM_ENABLED } from "@/lib/flags";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getSupabaseAdmin();
  const now = new Date().toISOString();
  const { data, error } = await db.from("consent_log")
    .select("id,pending_signup_id,weekly_send_dow")
    .eq("access_tier", "free_daily_trial").lte("free_trial_ends_at", now);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const due = data ?? [];
  if (!FREEMIUM_ENABLED || due.length === 0) {
    return NextResponse.json({ ok: true, dry_run: !FREEMIUM_ENABLED, due: due.length });
  }
  const ids = due.map((row) => row.id);
  const { error: updateError } = await db.from("consent_log").update({
    access_tier: "free_weekly", freemium_transitioned_at: now,
  }).in("id", ids);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  await db.from("conversion_events").insert(due.map((row) => ({
    session_id: null, event_name: "freemium_weekly_transition",
    pending_signup_id: row.pending_signup_id, properties: { consent_id: row.id },
  })));
  return NextResponse.json({ ok: true, dry_run: false, transitioned: ids.length });
}
