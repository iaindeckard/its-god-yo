import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizeSlot, isValidTimezone } from "@/lib/sendTime";

export const dynamic = "force-dynamic";

/**
 * Token-scoped capture of a teen's daily send time + timezone from the welcome
 * page. Auth = the unguessable consent_log.welcome_token delivered in the
 * post-YES SMS; there is no session. Writes ONLY send_time_local + timezone on
 * the single consent row that owns the token. The 7 AM floor / 30-min slot and
 * the IANA timezone are re-validated server-side here (the UI can't be trusted).
 *
 * Abuse surface is small (the token is a random uuid), but the write is scoped
 * to exactly one row and touches no other data; a per-IP limiter can be layered
 * on later if needed.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) return NextResponse.json({ error: "token is required" }, { status: 400 });

  const sendTime = normalizeSlot(body.send_time_local);
  if (!sendTime) {
    return NextResponse.json({ error: "invalid send time — must be a 30-minute slot at 7:00 AM or later" }, { status: 400 });
  }
  if (!isValidTimezone(body.timezone)) {
    return NextResponse.json({ error: "invalid timezone" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("consent_log")
    .update({ send_time_local: sendTime, timezone: body.timezone, updated_at: new Date().toISOString() })
    .eq("welcome_token", token)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: "update_failed" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({ ok: true, send_time_local: sendTime, timezone: body.timezone });
}
