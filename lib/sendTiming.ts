/**
 * Pure send-timing logic for the Stage 2 daily send, split out from lib/dailySend
 * (which is server-only + hits the DB) so the timezone / DST / day-0 / due-threshold
 * math can be unit-tested deterministically with a fixed "now". No side effects.
 */

/** Local calendar date ("YYYY-MM-DD") and minutes-since-midnight in `tz` at `atMs`. */
export function localParts(atMs: number, tz: string): { dateStr: string; minutes: number } {
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

/** "HH:MM" | "HH:MM:SS" -> minutes since midnight. */
export function hhmmToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export interface DueEval {
  due: boolean;
  localDate: string;
  localMinutes: number;
  sendMinutes: number;
  dayZero: boolean;
}

/**
 * Is this recipient due for a send at instant `nowMs`?
 * Due iff the recipient's LOCAL time is at/after their send time (so a missed
 * tick self-heals later the same day) AND it is not the local date they
 * confirmed on (decision B — first verse lands the NEXT local day).
 */
export function evaluateDue(
  nowMs: number,
  tz: string,
  sendTimeLocal: string,
  confirmedAtIso: string | null,
): DueEval {
  const { dateStr, minutes } = localParts(nowMs, tz);
  const sendMinutes = hhmmToMinutes(sendTimeLocal);
  const confirmedDate = confirmedAtIso ? localParts(new Date(confirmedAtIso).getTime(), tz).dateStr : null;
  const dayZero = confirmedDate !== null && dateStr <= confirmedDate;
  return { due: minutes >= sendMinutes && !dayZero, localDate: dateStr, localMinutes: minutes, sendMinutes, dayZero };
}
