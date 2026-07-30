import "server-only";
import { getSupabaseAdmin } from "./supabaseAdmin";
import { DAILY_SEND_ENABLED, SPANISH_ENABLED } from "./flags";

/**
 * Stage 2 daily-send tick (spec: docs/STAGE-2-SEND-MECHANISM-SPEC.md). Invoked
 * every 30 minutes by /api/cron/daily-send. For each active, confirmed
 * subscriber it resolves the current LOCAL wall-time in their timezone and, if
 * it's at/after their chosen send time and they haven't been sent yet today
 * (their local date), sends that local date's APPROVED verse in their language.
 *
 * Guarantees:
 *  - Exactly-once per (recipient, local date): claim-first INSERT into
 *    daily_send_log with UNIQUE(consent_id, send_local_date) + ON CONFLICT DO
 *    NOTHING. A second concurrent/replayed tick claims nothing and skips.
 *  - No fallback: if no APPROVED slot (or no translation for the language)
 *    exists for that local date, we record skipped_no_content + alert — never a
 *    random/unreviewed verse (decision C).
 *  - Day-0 suppression: no same-day send on the local date the teen confirmed;
 *    first verse lands the NEXT local day (decision B).
 *  - While DAILY_SEND_ENABLED is false, runs DRY: computes everything, makes no
 *    Twilio calls and writes no rows.
 */

interface AudienceRow {
  consent_id: string;
  pending_signup_id: string;
  recipient_phone: string;
  recipient_first_name: string | null;
  language: string | null;
  theme_track: string;
  send_time_local: string; // "HH:MM:SS"
  timezone: string;        // IANA
  confirmed_at: string | null;
}

/** Current local date ("YYYY-MM-DD") and minutes-since-midnight in `tz`. */
function localParts(atMs: number, tz: string): { dateStr: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(atMs));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  let hour = get("hour");
  if (hour === "24") hour = "00"; // some ICU builds emit "24" at midnight
  return {
    dateStr: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(hour) * 60 + Number(get("minute")),
  };
}

function hhmmToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

async function sendSms(to: string, body: string): Promise<{ sid: string; segments: number | null }> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!accountSid || !token || !from) throw new Error("twilio_not_configured");
  const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${accountSid}:${token}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ From: from, To: to, Body: body }).toString(),
  });
  const data = await resp.json().catch(() => ({} as Record<string, unknown>));
  if (!resp.ok) throw new Error(`twilio_${resp.status}: ${String((data as { message?: string })?.message ?? "").slice(0, 140)}`);
  const numSeg = (data as { num_segments?: string | number }).num_segments;
  return { sid: String((data as { sid?: string }).sid ?? ""), segments: numSeg != null ? Number(numSeg) : null };
}

export interface DailySendSummary {
  ran_at: string;
  dry_run: boolean;
  send_enabled: boolean;
  checked: number;
  not_due: number;
  due: number;
  sent: number;
  skipped_no_content: number;
  already_sent: number;
  failed: number;
  details: Array<Record<string, unknown>>;
}

export async function runDailySend(opts: { dryRun?: boolean } = {}): Promise<DailySendSummary> {
  const admin = getSupabaseAdmin();
  const nowMs = Date.now();
  const dryRun = opts.dryRun === true || !DAILY_SEND_ENABLED;

  const summary: DailySendSummary = {
    ran_at: new Date(nowMs).toISOString(),
    dry_run: dryRun,
    send_enabled: DAILY_SEND_ENABLED,
    checked: 0, not_due: 0, due: 0, sent: 0, skipped_no_content: 0, already_sent: 0, failed: 0,
    details: [],
  };

  const { data: audience, error } = await admin.from("daily_send_audience").select("*");
  if (error) throw new Error(`audience_query_failed: ${error.message}`);
  const rows = (audience ?? []) as AudienceRow[];
  summary.checked = rows.length;

  // Per-run cache of the approved slot for a (localDate, track).
  const slotCache = new Map<string, { id: string; en: string | null; es: string | null } | null>();
  async function loadSlot(dateStr: string, track: string) {
    const key = `${dateStr}|${track}`;
    if (!slotCache.has(key)) {
      const { data } = await admin
        .from("daily_slots")
        .select("id, final_translation, final_translation_es")
        .eq("scheduled_date", dateStr)
        .eq("theme_track", track)
        .eq("status", "approved")
        .maybeSingle();
      slotCache.set(key, data ? { id: data.id, en: data.final_translation, es: data.final_translation_es } : null);
    }
    return slotCache.get(key)!;
  }

  for (const r of rows) {
    const tz = r.timezone || "America/Chicago";
    const { dateStr, minutes } = localParts(nowMs, tz);
    const sendMin = hhmmToMinutes(r.send_time_local);
    const confirmedDate = r.confirmed_at ? localParts(new Date(r.confirmed_at).getTime(), tz).dateStr : null;

    // Decision B: no same-day send on the confirmation local date.
    const dayZero = confirmedDate !== null && dateStr <= confirmedDate;
    if (minutes < sendMin || dayZero) { summary.not_due++; continue; }
    summary.due++;

    const lang = r.language === "es" ? "es" : "en";
    const slot = await loadSlot(dateStr, r.theme_track);
    let text: string | null = null;
    let noContent: string | null = null;
    if (!slot) noContent = "no_approved_slot";
    else if (lang === "es") {
      if (!SPANISH_ENABLED) noContent = "spanish_disabled";
      else if (!slot.es) noContent = "no_es_translation";
      else text = slot.es;
    } else {
      if (!slot.en) noContent = "no_en_translation";
      else text = slot.en;
    }

    const base = { consent_id: r.consent_id, local_date: dateStr, track: r.theme_track, lang, tz };

    if (dryRun) {
      summary.details.push({ ...base, would: noContent ? `skip:${noContent}` : "send", preview: text ? text.slice(0, 60) : null });
      if (noContent) summary.skipped_no_content++; else summary.sent++;
      continue;
    }

    // Claim-first: exactly-once per (recipient, local date).
    const { data: claim, error: claimErr } = await admin
      .from("daily_send_log")
      .upsert(
        { consent_id: r.consent_id, send_local_date: dateStr, daily_slot_id: slot?.id ?? null, language: lang, status: "claimed" },
        { onConflict: "consent_id,send_local_date", ignoreDuplicates: true },
      )
      .select("id");
    if (claimErr) { summary.failed++; summary.details.push({ ...base, error: `claim_failed: ${claimErr.message}` }); continue; }
    if (!claim || claim.length === 0) { summary.already_sent++; continue; } // another tick already has this recipient/day
    const logId = (claim[0] as { id: string }).id;

    if (noContent) {
      console.error(`[daily-send][ALERT] no_content consent=${r.consent_id} date=${dateStr} track=${r.theme_track} lang=${lang} reason=${noContent}`);
      await admin.from("daily_send_log").update({ status: "skipped_no_content", error: noContent, updated_at: new Date().toISOString() }).eq("id", logId);
      summary.skipped_no_content++;
      summary.details.push({ ...base, result: "skipped_no_content", reason: noContent });
      continue;
    }

    try {
      const { sid, segments } = await sendSms(r.recipient_phone, text!);
      await admin.from("daily_send_log").update({ status: "sent", message_sid: sid, segments, updated_at: new Date().toISOString() }).eq("id", logId);
      summary.sent++;
      summary.details.push({ ...base, result: "sent", sid });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await admin.from("daily_send_log").update({ status: "failed", error: msg.slice(0, 200), updated_at: new Date().toISOString() }).eq("id", logId);
      summary.failed++;
      summary.details.push({ ...base, result: "failed", error: msg });
    }
  }

  return summary;
}
