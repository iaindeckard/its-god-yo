import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { claimAlert, resolveAlert } from "./alertState";

/**
 * Tier 2 of the task-notification system (LOCKED spec 2026-08-06): the content
 * runway alarm. This is the gap that prompted the whole design — there was no
 * advance warning before a themed track's approved content ran dry.
 *
 * Runway for a track = how many days of approved content remain from today,
 * measured as the furthest-out approved daily_slots.scheduled_date minus today
 * (exactly the spec's definition). When that drops under RUNWAY_THRESHOLD_DAYS we
 * email once per episode (dedup via igy_alert_state, alert_type='content_runway',
 * one entity_key per track) and stay quiet until the track recovers, at which
 * point it resolves so a later dip alerts again.
 *
 * Scope = the daily-cadence tracks only (general + the themed tracks). The
 * season_* tracks are event-windowed and already have their own dedicated T-14
 * alarm (cron/season-content-alarm), so they are intentionally excluded here to
 * avoid year-round false "0 days" alerts for out-of-season tracks.
 */

export const RUNWAY_THRESHOLD_DAYS = 7;
const ALERT_TYPE = "content_runway";

export interface TrackRunway {
  track: string;
  label: string;
  furthestApproved: string | null; // ISO date of the last approved slot, null if none upcoming
  runwayDays: number | null; // days from today to furthestApproved; null when no upcoming approved content
}

function daysUntil(todayIso: string, dateIso: string): number {
  const a = Date.parse(`${todayIso}T00:00:00Z`);
  const b = Date.parse(`${dateIso}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** A track is out of runway when it has no upcoming approved content, or the
 *  furthest-out approved date is under the threshold. */
export function isTripped(t: TrackRunway, thresholdDays = RUNWAY_THRESHOLD_DAYS): boolean {
  return t.runwayDays === null || t.runwayDays < thresholdDays;
}

/**
 * Per daily-cadence track, the furthest-out approved scheduled_date >= today and
 * the resulting runway in days. Queries only upcoming approved slots (bounded set)
 * so a fully-exhausted track shows up as furthestApproved=null (runwayDays=null).
 */
export async function computeRunway(db: SupabaseClient, todayIso: string): Promise<TrackRunway[]> {
  const { data: tracks, error: tErr } = await db
    .from("theme_tracks")
    .select("key, label, sort_order")
    .not("key", "like", "season_%")
    .order("sort_order");
  if (tErr) throw new Error(`theme_tracks_query_failed: ${tErr.message}`);

  const { data: slots, error: sErr } = await db
    .from("daily_slots")
    .select("theme_track, scheduled_date")
    .eq("status", "approved")
    .gte("scheduled_date", todayIso);
  if (sErr) throw new Error(`daily_slots_runway_query_failed: ${sErr.message}`);

  const maxByTrack: Record<string, string> = {};
  for (const s of slots ?? []) {
    const cur = maxByTrack[s.theme_track];
    if (!cur || s.scheduled_date > cur) maxByTrack[s.theme_track] = s.scheduled_date;
  }

  return (tracks ?? []).map((t) => {
    const furthest = maxByTrack[t.key] ?? null;
    return {
      track: t.key,
      label: t.label ?? t.key,
      furthestApproved: furthest,
      runwayDays: furthest ? daysUntil(todayIso, furthest) : null,
    };
  });
}

export type RunwayAlertSender = (tripped: TrackRunway[]) => Promise<{ dispatched: boolean }>;

/**
 * Evaluate runway and, for any track newly under threshold, fire ONE batched
 * email (all newly-tripped tracks in it). Tracks already alerted this episode are
 * suppressed; tracks now healthy are resolved so a future dip re-alerts. If the
 * email send fails we un-claim the batch so the next run retries.
 */
export async function runContentRunwayAlarm(args: {
  db: SupabaseClient;
  todayIso: string;
  sendAlert: RunwayAlertSender;
  thresholdDays?: number;
}): Promise<{ evaluated: TrackRunway[]; tripped: TrackRunway[]; alerted: TrackRunway[] }> {
  const { db, todayIso, sendAlert } = args;
  const threshold = args.thresholdDays ?? RUNWAY_THRESHOLD_DAYS;
  const evaluated = await computeRunway(db, todayIso);

  const tripped: TrackRunway[] = [];
  const toAlert: TrackRunway[] = [];
  for (const t of evaluated) {
    if (isTripped(t, threshold)) {
      tripped.push(t);
      const label = t.runwayDays === null ? "no upcoming approved content" : `${t.runwayDays}d runway`;
      console.error(`[content-runway][ALERT] ${t.track}: ${label} (threshold ${threshold}d)`);
      const fire = await claimAlert(db, {
        alertType: ALERT_TYPE,
        entityKey: t.track,
        cooldownMs: null, // once per episode; silent until the track recovers
        message: `${t.track}:${t.furthestApproved ?? "none"}`,
      });
      if (fire) toAlert.push(t);
    } else {
      // Recovered (or never tripped) → clear any prior episode so a later dip fires.
      await resolveAlert(db, { alertType: ALERT_TYPE, entityKey: t.track }).catch((e) =>
        console.error(`[content-runway] resolve failed for ${t.track}:`, e instanceof Error ? e.message : e),
      );
    }
  }

  if (toAlert.length > 0) {
    try {
      await sendAlert(toAlert);
    } catch (e) {
      // Un-claim so the next run retries rather than swallowing the episode.
      for (const t of toAlert) {
        await resolveAlert(db, { alertType: ALERT_TYPE, entityKey: t.track }).catch(() => {});
      }
      throw e;
    }
  }

  return { evaluated, tripped, alerted: toAlert };
}
