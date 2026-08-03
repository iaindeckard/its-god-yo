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
import { SEASON_KEYS } from "./catalog";

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
  translated_text: string | null; // slang translate is a separate downstream AI step
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

// ---------------------------------------------------------------------------
// Real verse selection (reuses get_theme_track_pool) + the T-30 generation trigger
// ---------------------------------------------------------------------------

/** Intended per-season theme track. NONE of these are populated yet — only
 *  `general` and `comfort_hard_times` tracks exist — so the selector falls back to
 *  `general` (tonally generic) until season-toned tracks are curated. */
export const SEASON_TRACK: Record<SeasonKey, string> = {
  advent: "season_advent",
  christmastide: "season_christmastide",
  lent: "season_lent",
  eastertide: "season_eastertide",
};

export interface PoolVerseSelector {
  (ctx: { season: SeasonKey; year: number; date: CalDate; dayIndex: number }): Promise<VerseSelection>;
  /** Which track a season actually drew from (the intended one, or `general` fallback). */
  trackUsedFor(season: SeasonKey): string;
}

/**
 * Real verse selector: draws from get_theme_track_pool — the SAME approved-verse
 * source the daily generate-monthly-batch pipeline uses. Tries the season track,
 * falls back to `general` when empty, dedups within a run, and spreads picks across
 * the pool. Fills verse_ref + KJV verse_text; the teen-slang translation is the same
 * separate downstream AI step as the daily pipeline (left null here).
 */
const normalizeVerseText = (t: string): string => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const hash32 = (s: string): number => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
};

/**
 * (c) fix + spread fix. Dedupe a pool by NORMALIZED verse text — different refs with
 * identical wording (e.g. 1 Chron 16:10 vs Ps 105:3) collapse to one, so no season can
 * ship the same message twice — then order by a stable hash of the ref so day-to-day
 * picks are scattered across the whole pool regardless of size (kills the ref-adjacent
 * clustering that put consecutive verses on day 1 of three seasons). Pure + deterministic.
 */
export function orderedDistinctPool(rows: { ref: string; text: string }[]): { ref: string; text: string }[] {
  const seen = new Set<string>();
  const distinct: { ref: string; text: string }[] = [];
  for (const r of rows) {
    const k = normalizeVerseText(r.text);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    distinct.push(r);
  }
  return distinct.sort((a, b) => hash32(a.ref) - hash32(b.ref) || (a.ref < b.ref ? -1 : 1));
}

export async function makePoolVerseSelector(db: SupabaseClient): Promise<PoolVerseSelector> {
  const lists = new Map<string, { ref: string; text: string }[]>();
  const cursor = new Map<string, number>();
  const trackUsed = new Map<SeasonKey, string>();

  async function listFor(track: string) {
    if (!lists.has(track)) {
      const { data, error } = await db.rpc("get_theme_track_pool", { p_track: track });
      if (error) throw new Error(`get_theme_track_pool(${track}) failed: ${error.message}`);
      const rows = ((data ?? []) as { book: string; chapter: number; verse: number; text: string }[]).map((r) => ({
        ref: `${r.book} ${r.chapter}:${r.verse}`,
        text: r.text,
      }));
      lists.set(track, orderedDistinctPool(rows));
      cursor.set(track, 0);
    }
    return lists.get(track)!;
  }

  const selector = (async (ctx) => {
    let track = SEASON_TRACK[ctx.season];
    let list = await listFor(track);
    if (list.length === 0) {
      track = "general";
      list = await listFor("general");
    }
    trackUsed.set(ctx.season, track);
    if (list.length === 0) throw new Error(`no eligible verses for ${ctx.season} (pool empty)`);
    const i = cursor.get(track)!;
    cursor.set(track, i + 1);
    const v = list[i % list.length]; // wraps only if the pool is smaller than the batch
    return { verse_ref: v.ref, verse_text: v.text, translated_text: null };
  }) as PoolVerseSelector;
  selector.trackUsedFor = (s: SeasonKey) => trackUsed.get(s) ?? SEASON_TRACK[s];
  return selector;
}

/**
 * T-30 generation trigger. For each season whose review window is open
 * (today in [seasonStart − 30, seasonStart]) and that has no batch yet, generates
 * the batch. Idempotent — an existing batch is skipped. This is what the daily
 * season-content-generate cron runs.
 */
export async function runSeasonGeneration(args: {
  db: SupabaseClient;
  today: CalDate;
  selectVerse: VerseSelector;
  reviewWindowDays?: number;
}): Promise<{ generated: { season: SeasonKey; year: number; itemCount: number }[] }> {
  const { db, today, selectVerse } = args;
  const reviewWindowDays = args.reviewWindowDays ?? REVIEW_WINDOW_DAYS;
  const generated: { season: SeasonKey; year: number; itemCount: number }[] = [];
  for (const season of SEASON_KEYS) {
    for (const y of [today.year - 1, today.year, today.year + 1]) {
      const start = seasonWindows(y)[season].start;
      const reviewOpens = addDays(start, -reviewWindowDays);
      if (iso(reviewOpens) <= iso(today) && iso(today) <= iso(start)) {
        const { data: existing } = await db
          .from("season_content_batches")
          .select("id")
          .eq("season_key", season)
          .eq("liturgical_year", y)
          .maybeSingle();
        if (existing) continue;
        const { itemCount } = await generateSeasonBatch({ db, season, year: y, selectVerse, reviewWindowDays });
        generated.push({ season, year: y, itemCount });
      }
    }
  }
  return { generated };
}
