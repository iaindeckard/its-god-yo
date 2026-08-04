import "server-only";
import { getSupabaseAdmin } from "./supabaseAdmin";
import { DAILY_SEND_ENABLED, SPANISH_ENABLED } from "./flags";
import { smsCostCents, TWILIO_US_SEGMENT_PRICE_CENTS, TWILIO_US_TOLLFREE_CARRIER_FEE_CENTS } from "./costs";
import { evaluateDue } from "./sendTiming";
import { composeDailyMessage } from "./dmAddon";

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
 *  - No-silence / General fallback: if the recipient's CHOSEN track has no
 *    approved slot (or no translation for the language) for that local date, we
 *    fall back to that date's approved GENERAL slot rather than skipping. Only if
 *    General is also unavailable do we record skipped_no_content + alert. Still
 *    never a random/unreviewed verse (decision C) — the fallback is an approved,
 *    human-reviewed General verse; a themed subscriber may occasionally receive a
 *    General message on days their track has no content (disclosed to them).
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

export async function sendSms(to: string, body: string): Promise<{ sid: string; segments: number | null }> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!accountSid || !token || !from) throw new Error("twilio_not_configured");
  const form: Record<string, string> = { From: from, To: to, Body: body };
  // Point Twilio at the delivery-status webhook so /api/twilio/status can advance
  // daily_send_log (sent -> delivered/undelivered/failed) and alert on failure.
  const statusUrl = process.env.TWILIO_STATUS_URL
    || (process.env.NEXT_PUBLIC_SITE_URL ? `${process.env.NEXT_PUBLIC_SITE_URL}/api/twilio/status` : "");
  if (statusUrl) form.StatusCallback = statusUrl;
  const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${accountSid}:${token}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(form).toString(),
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

  // Which subscribers have the DM from Him add-on on — resolved from their
  // pending_signup. Opted-in recipients get the same verse re-wrapped in
  // first-person framing (composeDailyMessage); everyone else gets it as-is.
  const dmBySignup = new Map<string, boolean>();
  const signupIds = [...new Set(rows.map((r) => r.pending_signup_id).filter(Boolean))];
  if (signupIds.length) {
    const { data: dmRows } = await admin.from("pending_signups").select("id, dm_addon").in("id", signupIds);
    for (const d of (dmRows ?? []) as Array<{ id: string; dm_addon: boolean | null }>) dmBySignup.set(d.id, !!d.dm_addon);
  }

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
    const { due, localDate: dateStr } = evaluateDue(nowMs, tz, r.send_time_local, r.confirmed_at);
    if (!due) { summary.not_due++; continue; }
    summary.due++;

    const lang = r.language === "es" ? "es" : "en";
    // Resolve this track's approved verse for the date. Pull the usable text for
    // the recipient's language, or a reason it isn't available.
    const pick = (s: { id: string; en: string | null; es: string | null } | null): { text: string | null; reason: string | null } => {
      if (!s) return { text: null, reason: "no_approved_slot" };
      if (lang === "es") {
        if (!SPANISH_ENABLED) return { text: null, reason: "spanish_disabled" };
        if (!s.es) return { text: null, reason: "no_es_translation" };
        return { text: s.es, reason: null };
      }
      if (!s.en) return { text: null, reason: "no_en_translation" };
      return { text: s.en, reason: null };
    };

    // No-silence rule: if the subscriber's chosen track has no approved content
    // for this date, fall back to that day's approved GENERAL slot rather than
    // skipping. Worst case they get a General verse instead of their track's — a
    // themed subscriber may occasionally receive a General message (disclosed).
    let effectiveSlot = await loadSlot(dateStr, r.theme_track);
    let picked = pick(effectiveSlot);
    let text = picked.text;
    let noContent = picked.reason;
    let usedGeneralFallback = false;
    if (text == null && r.theme_track !== "general") {
      const gen = await loadSlot(dateStr, "general");
      const alt = pick(gen);
      if (alt.text != null) {
        effectiveSlot = gen;
        text = alt.text;
        noContent = null;
        usedGeneralFallback = true;
      }
    }

    // DM from Him: opted-in recipients get the SAME verse wrapped in first-person
    // framing; everyone else gets it verbatim. Never a different/second verse.
    const dmOn = dmBySignup.get(r.pending_signup_id) === true;
    const body = text != null ? composeDailyMessage(text, { dm: dmOn, firstName: r.recipient_first_name, lang }) : null;

    const base = { consent_id: r.consent_id, local_date: dateStr, track: r.theme_track, lang, tz, dm: dmOn, general_fallback: usedGeneralFallback };

    if (dryRun) {
      summary.details.push({ ...base, would: noContent ? `skip:${noContent}` : "send", preview: body ? body.slice(0, 80) : null });
      if (noContent) summary.skipped_no_content++; else summary.sent++;
      continue;
    }

    // Claim-first: exactly-once per (recipient, local date).
    const { data: claim, error: claimErr } = await admin
      .from("daily_send_log")
      .upsert(
        { consent_id: r.consent_id, send_local_date: dateStr, daily_slot_id: effectiveSlot?.id ?? null, language: lang, status: "claimed" },
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
      const { sid, segments } = await sendSms(r.recipient_phone, body!);
      await admin.from("daily_send_log").update({ status: "sent", message_sid: sid, segments, updated_at: new Date().toISOString() }).eq("id", logId);
      // Stamp the financial cost row (segment-based, per lib/costs.ts constants).
      // Exactly-once already guaranteed by the claim, so no dup cost rows.
      const seg = segments ?? 1;
      const { error: costErr } = await admin.from("igy_sms_log").insert({
        message_sid: sid,
        direction: "outbound",
        segments: seg,
        unit_price_cents: seg * TWILIO_US_SEGMENT_PRICE_CENTS,
        carrier_fee_cents: seg * TWILIO_US_TOLLFREE_CARRIER_FEE_CENTS,
        cost_cents: smsCostCents(seg),
        sent_on: dateStr,
        sent_at: new Date().toISOString(),
        pending_signup_id: r.pending_signup_id,
        notes: `daily-send ${r.theme_track}/${lang}`,
      });
      if (costErr) console.error(`[daily-send] cost_log_failed sid=${sid}: ${costErr.message}`);
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
