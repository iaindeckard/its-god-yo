import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cronAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getConfig, logAudit } from "@/lib/cornerstone";
import { sendCornerstoneEmail, enrollmentDeadlineEmail } from "@/lib/cornerstoneEmails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * #9 Enrollment deadline approaching — SCHEDULED, not per-request.
 *
 * Runs daily. Does nothing unless cornerstone_config.enrollment_closes_at is set
 * AND the deadline is within the reminder window (default 7 days, ?days=N). Then
 * it nudges the contact of every application still in a pre-decision state
 * (submitted / under_review / awaiting_payment). Transactional: these churches
 * applied themselves. Idempotent — an 'enrollment_reminder_sent' audit row per
 * application prevents a second send, so re-runs within the window are safe.
 *
 * Auth: a CRON_SECRET bearer (auto-sent by Vercel Cron) for manual/test runs.
 * Query: ?days=N reminder window (default 7); ?dry=1 counts targets, sends nothing.
 */
const OPEN_STATUSES = ["submitted", "under_review", "awaiting_payment"];

export async function GET(req: Request) {
  const authed = isAuthorizedCron(req);
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const windowDays = Math.max(1, Number(url.searchParams.get("days") || 7));
  const dry = url.searchParams.get("dry") === "1";

  const config = await getConfig();
  if (!config.enrollment_closes_at) {
    return NextResponse.json({ skipped: "no enrollment_closes_at configured" });
  }
  const closesAt = new Date(config.enrollment_closes_at);
  const now = new Date();
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysUntil = Math.ceil((closesAt.getTime() - now.getTime()) / msPerDay);
  if (daysUntil < 0 || daysUntil > windowDays) {
    return NextResponse.json({ skipped: `deadline ${daysUntil} day(s) away, outside ${windowDays}-day window` });
  }
  const closesOn = config.enrollment_closes_at.slice(0, 10);

  const admin = getSupabaseAdmin();
  const { data: apps, error } = await admin
    .from("cornerstone_applications")
    .select("id, contact_email, church:churches(name)")
    .in("status", OPEN_STATUSES);
  if (error) return NextResponse.json({ error: `query_failed: ${error.message}` }, { status: 500 });
  const open = (apps ?? []) as unknown as { id: string; contact_email: string | null; church: { name: string } | null }[];

  // Which of these were already reminded (idempotency).
  const { data: sentRows } = await admin
    .from("cornerstone_audit_log")
    .select("application_id")
    .eq("action", "enrollment_reminder_sent");
  const alreadySent = new Set((sentRows ?? []).map((r: { application_id: string | null }) => r.application_id));

  const targets = open.filter((a) => a.contact_email && !alreadySent.has(a.id));
  if (dry) {
    return NextResponse.json({ dry: true, daysUntil, closesOn, targets: targets.length });
  }

  let sent = 0;
  for (const a of targets) {
    const id = await sendCornerstoneEmail(a.contact_email, enrollmentDeadlineEmail(a.church?.name ?? "your church", closesOn));
    if (id !== null) sent++;
    // Mark regardless of provider outcome so we don't hammer a failing address daily.
    await logAudit({ application_id: a.id, action: "enrollment_reminder_sent", new_value: { closesOn } });
  }
  return NextResponse.json({ ok: true, daysUntil, closesOn, targeted: targets.length, sent });
}
