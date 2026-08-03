import type { SupabaseClient } from "@supabase/supabase-js";
import {
  seasonWindows,
  freeClimaxDays,
  addDays,
  weekday,
  iso,
  parseIso,
  daysBetween,
  type SeasonKey,
  type CalDate,
} from "./liturgical";

/**
 * Phase C — seasonal content pipeline + review queue.
 *
 * Forked from the daily generate-monthly-batch approach (same verse-pool selection
 * source), but writes to its OWN batch/item review queue, NOT daily_slots.needs_review.
 * The whole season batch is generated and reviewed AHEAD of the season; Phase B's
 * billing gate only charges once the batch is `approved`. Orchestration lives here
 * (testable, dependency-injected); the verse SELECTION is injected so the real path
 * can reuse get_theme_track_pool / the AI translate step while tests stay deterministic.
 */

export const REVIEW_WINDOW_DAYS = 30; // T-30 review opens
export const REVIEW_ALARM_DAYS = 14; // T-14 alarm

/**
 * Paid-EXCLUSIVE send dates for a season+year: every day in the Phase 0 window,
 * MINUS free climax days (never double-send those — the free pipeline covers the
 * whole base) and MINUS Sundays for Lent only (feast days, not fast days). Yields
 * Christmastide 11, Advent 22–28, Lent 39, Eastertide 48. See build notes.
 */
export function seasonSendDates(season: SeasonKey, year: number): CalDate[] {
  const w = seasonWindows(year)[season];
  // Window can cross a year boundary (Christmastide); collect free days from the
  // years around it so boundary climax days are excluded correctly.
  const free = new Set(
    [year - 1, year, year + 1].flatMap((y) => freeClimaxDays(y).map((d) => iso(d.date))),
  );
  const out: CalDate[] = [];
  for (let d = w.start; iso(d) <= iso(w.end); d = addDays(d, 1)) {
    if (free.has(iso(d))) continue; // free climax day → delivered free to everyone
    if (season === "lent" && weekday(d) === 0) continue; // Lent skips Sundays
    out.push(d);
  }
  return out;
}

export interface VerseSelection {
  verse_ref: string;
  verse_text: string;
  translated_text: string;
}
export type VerseSelector = (ctx: {
  season: SeasonKey;
  year: number;
  date: CalDate;
  dayIndex: number;
}) => Promise<VerseSelection>;

/**
 * Generate (or top up) a season's content batch: creates the batch in `in_review`
 * with its T-30/T-14 dates, and one `pending` item per send date. Idempotent —
 * existing reviewed items are never overwritten.
 */
export async function generateSeasonBatch(args: {
  db: SupabaseClient;
  season: SeasonKey;
  year: number;
  selectVerse: VerseSelector;
  reviewWindowDays?: number;
}): Promise<{ batchId: string; itemCount: number }> {
  const { db, season, year, selectVerse } = args;
  const reviewWindowDays = args.reviewWindowDays ?? REVIEW_WINDOW_DAYS;
  const dates = seasonSendDates(season, year);
  const seasonStart = seasonWindows(year)[season].start;
  const reviewOpens = addDays(seasonStart, -reviewWindowDays);

  const { data: batch, error: bErr } = await db
    .from("season_content_batches")
    .upsert(
      {
        season_key: season,
        liturgical_year: year,
        status: "in_review",
        season_start: iso(seasonStart),
        review_opens_at: iso(reviewOpens),
        total_items: dates.length,
      },
      { onConflict: "season_key,liturgical_year" },
    )
    .select("id")
    .single();
  if (bErr) throw new Error(`batch upsert failed: ${bErr.message}`);
  const batchId = batch!.id as string;

  let itemCount = 0;
  for (let i = 0; i < dates.length; i++) {
    const sel = await selectVerse({ season, year, date: dates[i], dayIndex: i });
    const { error } = await db.from("season_content_items").upsert(
      {
        batch_id: batchId,
        send_date: iso(dates[i]),
        day_index: i,
        verse_ref: sel.verse_ref,
        verse_text: sel.verse_text,
        translated_text: sel.translated_text,
        status: "pending",
      },
      { onConflict: "batch_id,send_date", ignoreDuplicates: true },
    );
    if (!error) itemCount++;
  }
  return { batchId, itemCount };
}

/** Recompute a batch's roll-up: approved when (and only when) every item is approved. */
async function rollUpBatch(db: SupabaseClient, batchId: string) {
  const total = (await db.from("season_content_items").select("*", { count: "exact", head: true }).eq("batch_id", batchId)).count ?? 0;
  const approved = (await db.from("season_content_items").select("*", { count: "exact", head: true }).eq("batch_id", batchId).eq("status", "approved")).count ?? 0;
  const done = total > 0 && approved === total;
  await db
    .from("season_content_batches")
    .update({ approved_items: approved, status: done ? "approved" : "in_review", approved_at: done ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
    .eq("id", batchId);
  return { total, approved, batchStatus: done ? "approved" : ("in_review" as const) };
}

export async function approveItem(db: SupabaseClient, itemId: string, reviewer: string) {
  const { data: item, error } = await db
    .from("season_content_items")
    .update({ status: "approved", reject_reason: null, reviewed_by: reviewer, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", itemId)
    .select("batch_id")
    .single();
  if (error) throw new Error(`approveItem failed: ${error.message}`);
  return rollUpBatch(db, item!.batch_id as string);
}

export async function rejectItem(db: SupabaseClient, itemId: string, reviewer: string, reason: string) {
  const { data: item, error } = await db
    .from("season_content_items")
    .update({ status: "rejected", reject_reason: reason, reviewed_by: reviewer, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", itemId)
    .select("batch_id")
    .single();
  if (error) throw new Error(`rejectItem failed: ${error.message}`);
  return rollUpBatch(db, item!.batch_id as string);
}

export interface SeasonReviewAlert {
  season: SeasonKey;
  seasonYear: number;
  daysUntilStart: number;
  approved: number;
  total: number;
}
export type AlertSender = (a: SeasonReviewAlert) => Promise<{ dispatched: boolean }>;

/**
 * T-14 content-review alarm. Fires once per batch (t14_alerted_at stamp) for any
 * batch not yet approved whose season starts within REVIEW_ALARM_DAYS. Uses the
 * injected alert sender (prod = the shared ops-alert Resend channel) plus a
 * structured [season-review][ALERT] log — the same alerting mechanism as the rest
 * of the ops warnings, not a new one.
 */
export async function runSeasonReviewAlarm(args: {
  db: SupabaseClient;
  today: CalDate;
  sendAlert: AlertSender;
  alarmDays?: number;
}): Promise<{ tripped: SeasonReviewAlert[] }> {
  const { db, today, sendAlert } = args;
  const alarmDays = args.alarmDays ?? REVIEW_ALARM_DAYS;
  const { data: batches, error } = await db
    .from("season_content_batches")
    .select("id, season_key, liturgical_year, season_start, status, approved_items, total_items, t14_alerted_at")
    .neq("status", "approved")
    .is("t14_alerted_at", null);
  if (error) throw new Error(`alarm query failed: ${error.message}`);

  const tripped: SeasonReviewAlert[] = [];
  for (const b of batches ?? []) {
    if (!b.season_start) continue;
    const days = daysBetween(today, parseIso(b.season_start));
    if (days > alarmDays || days < -60) continue; // only within the alarm window (incl. overdue)
    const alert: SeasonReviewAlert = {
      season: b.season_key as SeasonKey,
      seasonYear: b.liturgical_year as number,
      daysUntilStart: days,
      approved: b.approved_items as number,
      total: b.total_items as number,
    };
    console.error(
      `[season-review][ALERT] ${alert.season} ${alert.seasonYear} not approved: ${alert.approved}/${alert.total}, ${days}d to start`,
    );
    await sendAlert(alert);
    await db.from("season_content_batches").update({ t14_alerted_at: new Date().toISOString() }).eq("id", b.id);
    tripped.push(alert);
  }
  return { tripped };
}
