/**
 * Shared send-time helpers for the teen welcome page (/welcome) and the
 * token-scoped capture endpoint (/api/welcome). Locked spec
 * (project_igy_send_time_spec): 30-minute slots, 7:00 AM local FLOOR, default
 * 12:00 PM (noon). Usable from both client and server (no server-only deps).
 */

export const SEND_TIME_FLOOR = "07:00";   // 7:00 AM local — no earlier (protects against a joke/accidental early pick)
export const SEND_TIME_CEIL = "21:30";    // last selectable slot: 9:30 PM
export const SEND_TIME_DEFAULT = "12:00"; // noon, applied when a teen never sets one

/** Every selectable 30-min slot "HH:MM" (24h), floor..ceil inclusive. */
export function sendTimeSlots(): string[] {
  const [fh, fm] = SEND_TIME_FLOOR.split(":").map(Number);
  const [ch, cm] = SEND_TIME_CEIL.split(":").map(Number);
  const end = ch * 60 + cm;
  const slots: string[] = [];
  for (let mins = fh * 60 + fm; mins <= end; mins += 30) {
    slots.push(`${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`);
  }
  return slots;
}

/** "13:30" -> "1:30 PM". Accepts "HH:MM" or "HH:MM:SS". */
export function formatSlot(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/**
 * Valid iff on a 30-min boundary within [floor, ceil]. Returns the normalized
 * "HH:MM" (dropping any seconds) or null. The server MUST re-validate with this
 * — the 7 AM floor is a real guard, not just UI.
 */
export function normalizeSlot(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const hh = Number(m[1]), mm = Number(m[2]);
  if (hh > 23 || (mm !== 0 && mm !== 30)) return null;
  const mins = hh * 60 + mm;
  const [fh, fm] = SEND_TIME_FLOOR.split(":").map(Number);
  const [ch, cm] = SEND_TIME_CEIL.split(":").map(Number);
  if (mins < fh * 60 + fm || mins > ch * 60 + cm) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/**
 * True iff `tz` is a valid IANA timezone — validated via Intl rather than a
 * hardcoded list, so any real zone is accepted and anything bogus is rejected.
 * (Node/Vercel ships full ICU, so this is reliable server-side.)
 */
export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Curated zones offered in the welcome-page picker (US/CA/MX launch markets).
 *  The detected zone is added on top if not already present; the API accepts any
 *  valid IANA name regardless. */
export const COMMON_TIMEZONES: Array<{ id: string; label: string }> = [
  { id: "America/New_York", label: "Eastern — New York" },
  { id: "America/Chicago", label: "Central — Chicago" },
  { id: "America/Denver", label: "Mountain — Denver" },
  { id: "America/Phoenix", label: "Mountain (no DST) — Phoenix" },
  { id: "America/Los_Angeles", label: "Pacific — Los Angeles" },
  { id: "America/Anchorage", label: "Alaska — Anchorage" },
  { id: "Pacific/Honolulu", label: "Hawaii — Honolulu" },
  { id: "America/Toronto", label: "Eastern (CA) — Toronto" },
  { id: "America/Vancouver", label: "Pacific (CA) — Vancouver" },
  { id: "America/Mexico_City", label: "Central (MX) — Mexico City" },
  { id: "America/Tijuana", label: "Pacific (MX) — Tijuana" },
];
