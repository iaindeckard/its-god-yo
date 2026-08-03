import type { SupabaseClient } from "@supabase/supabase-js";
import { freeClimaxDays, iso, parseIso, type CalDate } from "./liturgical";
import { evaluateDue } from "../sendTiming";

/**
 * Phase D — free climax-day sends. The six climax days (Christmas Day, Epiphany,
 * Palm Sunday, Good Friday, Easter Sunday, Pentecost) go to the ENTIRE active base,
 * no purchase required, independent of any paid season enrollment.
 *
 * Never-double-message: this claims the SAME daily_send_log key (consent_id,
 * send_local_date) the daily-verse (and future season) pipeline uses, so a subscriber
 * can be claimed only once per calendar day — whichever pipeline claims first owns the
 * day, the rest skip. And the paid season windows already EXCLUDE these six dates
 * (seasonSendDates), so a season subscriber never has a second send queued on a climax
 * day in the first place. Dependency-injected (db, clock, sms) so it's testable for real.
 */

const LABEL_TO_KEY: Record<string, string> = {
  "Christmas Day": "christmas_day",
  Epiphany: "epiphany",
  "Palm Sunday": "palm_sunday",
  "Good Friday": "good_friday",
  "Easter Sunday": "easter_sunday",
  Pentecost: "pentecost",
};

/** If `localDate` is one of the six climax days for its year, the key+label; else null. */
export function climaxDayFor(localDate: CalDate): { key: string; label: string } | null {
  const target = iso(localDate);
  for (const d of freeClimaxDays(localDate.year)) {
    if (iso(d.date) === target) return { key: LABEL_TO_KEY[d.label], label: d.label };
  }
  return null;
}

export type SmsSender = (to: string, body: string) => Promise<{ sid: string; segments: number | null }>;

export interface ClimaxSendSummary {
  dry_run: boolean;
  climax: { key: string; label: string } | null;
  audience: number;
  not_due: number;
  not_climax: number;
  skipped_no_content: number;
  would_send: number;
  sent: number;
  already_sent: number;
  failed: number;
  details: Array<Record<string, unknown>>;
}

export async function runClimaxSend(args: {
  db: SupabaseClient;
  nowMs: number;
  dryRun?: boolean;
  sendSms?: SmsSender;
}): Promise<ClimaxSendSummary> {
  const { db, nowMs } = args;
  const dryRun = args.dryRun ?? false;
  const s: ClimaxSendSummary = {
    dry_run: dryRun, climax: null, audience: 0, not_due: 0, not_climax: 0,
    skipped_no_content: 0, would_send: 0, sent: 0, already_sent: 0, failed: 0, details: [],
  };

  const { data: audience, error } = await db.from("daily_send_audience").select("*");
  if (error) throw new Error(`audience_query_failed: ${error.message}`);
  s.audience = (audience ?? []).length;

  const contentCache = new Map<string, string | null>();
  async function contentFor(key: string, year: number): Promise<string | null> {
    const ck = `${key}|${year}`;
    if (!contentCache.has(ck)) {
      // Climax messages are timeless: liturgical_year=0 is the every-year default.
      // A specific-year row (>0) acts as a one-off override and wins when present.
      const { data } = await db
        .from("climax_content")
        .select("verse_text, translated_text, liturgical_year")
        .eq("climax_key", key)
        .in("liturgical_year", [year, 0])
        .eq("status", "approved")
        .order("liturgical_year", { ascending: false })
        .limit(1)
        .maybeSingle();
      contentCache.set(ck, data ? (data.translated_text ?? data.verse_text ?? null) : null);
    }
    return contentCache.get(ck)!;
  }

  for (const r of (audience ?? []) as Array<Record<string, unknown>>) {
    const tz = (r.timezone as string) || "America/Chicago";
    const { due, localDate } = evaluateDue(nowMs, tz, r.send_time_local as string, r.confirmed_at as string | null);
    if (!due) { s.not_due++; continue; }
    const cd = climaxDayFor(parseIso(localDate));
    if (!cd) { s.not_climax++; continue; }
    s.climax = cd;

    const year = parseIso(localDate).year;
    const body = await contentFor(cd.key, year);
    if (!body) {
      s.skipped_no_content++;
      s.details.push({ consent_id: r.consent_id, date: localDate, climax: cd.key, result: "skipped_no_content" });
      continue;
    }

    if (dryRun) {
      s.would_send++;
      s.details.push({ consent_id: r.consent_id, date: localDate, climax: cd.key, would: "send", preview: body.slice(0, 60) });
      continue;
    }

    // Claim-first in the SHARED daily_send_log — one message/day across pipelines.
    const { data: claim, error: claimErr } = await db
      .from("daily_send_log")
      .upsert(
        { consent_id: r.consent_id, send_local_date: localDate, language: r.language === "es" ? "es" : "en", status: "claimed", send_kind: "climax", climax_key: cd.key },
        { onConflict: "consent_id,send_local_date", ignoreDuplicates: true },
      )
      .select("id");
    if (claimErr) { s.failed++; s.details.push({ consent_id: r.consent_id, error: claimErr.message }); continue; }
    if (!claim || claim.length === 0) { s.already_sent++; continue; } // another pipeline/run owns this day
    const logId = (claim[0] as { id: string }).id;

    try {
      if (!args.sendSms) throw new Error("no_sms_sender");
      const { sid, segments } = await args.sendSms(r.recipient_phone as string, body);
      await db.from("daily_send_log").update({ status: "sent", message_sid: sid, segments, updated_at: new Date().toISOString() }).eq("id", logId);
      s.sent++;
    } catch (e) {
      await db.from("daily_send_log").update({ status: "failed", error: (e as Error).message, updated_at: new Date().toISOString() }).eq("id", logId);
      s.failed++;
    }
  }
  return s;
}
