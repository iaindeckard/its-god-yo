// Pure liturgical date engine for the WESTERN (Gregorian) liturgical calendar.
// No I/O, no `server-only` — safe to unit-test and to import anywhere.
//
// EVERYTHING here derives from one number: the Gregorian Easter date. IGY is a
// Western-church product (Advent / Lent / Eastertide, Episcopal/BCP affinity), so
// this uses the GREGORIAN computus — NOT the Julian/Orthodox one (which can differ
// by up to five weeks). A wrong Easter silently shifts Ash Wednesday, Palm Sunday,
// Good Friday, Eastertide and Pentecost, which is why liturgical.test.ts cross-checks
// TWO independent Easter algorithms against a table of known real Easter dates before
// any product logic is allowed to depend on it.

/** A calendar date with no time and no timezone. All math here is TZ-free. */
export interface CalDate {
  year: number;
  month: number; // 1–12
  day: number; // 1–31
}

const MS_PER_DAY = 86_400_000;

// Internal: anchor every date at UTC midnight so day arithmetic never drifts with
// the host timezone or DST.
const toEpoch = (d: CalDate): number => Date.UTC(d.year, d.month - 1, d.day);
const fromEpoch = (ms: number): CalDate => {
  const dt = new Date(ms);
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
};

export const addDays = (d: CalDate, n: number): CalDate => fromEpoch(toEpoch(d) + n * MS_PER_DAY);
/** 0 = Sunday … 6 = Saturday. */
export const weekday = (d: CalDate): number => new Date(toEpoch(d)).getUTCDay();
/** Inclusive day count from a → b (a and b both counted). Negative if b < a. */
export const daysInclusive = (a: CalDate, b: CalDate): number =>
  Math.round((toEpoch(b) - toEpoch(a)) / MS_PER_DAY) + 1;
export const iso = (d: CalDate): string =>
  `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
export const parseIso = (s: string): CalDate => {
  const [y, m, d] = s.split("-").map(Number);
  return { year: y, month: m, day: d };
};
/** Signed day count b − a (positive if b is after a). */
export const daysBetween = (a: CalDate, b: CalDate): number =>
  Math.round((toEpoch(b) - toEpoch(a)) / MS_PER_DAY);

/**
 * Gregorian (Western) Easter Sunday via the "Anonymous Gregorian algorithm"
 * (a.k.a. Meeus/Jones/Butcher) — the standard reference computus, valid for every
 * Gregorian year (1583+). Cross-checked in tests against an independent Gauss
 * implementation over 1583–2600 and against a table of known real Easters.
 */
export function gregorianEaster(year: number): CalDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { year, month, day };
}

/** First Sunday of Advent = the Sunday nearest 30 November (Western/BCP rule). */
export function firstSundayOfAdvent(year: number): CalDate {
  const nov30: CalDate = { year, month: 11, day: 30 };
  const w = weekday(nov30);
  // Nearest Sunday: within 3 days back → go back; otherwise forward to next Sunday.
  return w <= 3 ? addDays(nov30, -w) : addDays(nov30, 7 - w);
}

/**
 * Easter-cycle anchor dates for the Easter falling in `year`. Lent length is 40
 * days *excluding* Sundays; Ash Wednesday is therefore Easter − 46 calendar days.
 */
export interface EasterCycle {
  ashWednesday: CalDate; // Easter − 46
  palmSunday: CalDate; // Easter − 7
  goodFriday: CalDate; // Easter − 2
  holySaturday: CalDate; // Easter − 1
  easterSunday: CalDate;
  pentecost: CalDate; // Easter + 49
}
export function easterCycle(year: number): EasterCycle {
  const easterSunday = gregorianEaster(year);
  return {
    ashWednesday: addDays(easterSunday, -46),
    palmSunday: addDays(easterSunday, -7),
    goodFriday: addDays(easterSunday, -2),
    holySaturday: addDays(easterSunday, -1),
    easterSunday,
    pentecost: addDays(easterSunday, 49),
  };
}

/**
 * Christmas-cycle anchor dates, keyed by the year Christmas Day falls in. Note the
 * cycle crosses the year boundary: Christmastide runs into `yearOfChristmas + 1`
 * and Epiphany (which closes the cycle) is 6 Jan of `yearOfChristmas + 1`.
 */
export interface ChristmasCycle {
  firstSundayOfAdvent: CalDate; // in yearOfChristmas
  christmasDay: CalDate; // 25 Dec yearOfChristmas
  christmastideEnd: CalDate; // 5 Jan yearOfChristmas + 1
  epiphany: CalDate; // 6 Jan yearOfChristmas + 1
}
export function christmasCycle(yearOfChristmas: number): ChristmasCycle {
  return {
    firstSundayOfAdvent: firstSundayOfAdvent(yearOfChristmas),
    christmasDay: { year: yearOfChristmas, month: 12, day: 25 },
    christmastideEnd: { year: yearOfChristmas + 1, month: 1, day: 5 },
    // Epiphany is FIXED on 6 Jan, never transferred to the nearest Sunday. This is
    // the Episcopal Church / BCP rule (IGY's named affinity partner). Only the US
    // Roman Catholic Church transfers it to the Sunday of Jan 2–8; IGY is not
    // RC-specific, so do NOT switch this to a transferred date.
    epiphany: { year: yearOfChristmas + 1, month: 1, day: 6 },
  };
}

export type SeasonKey = "advent" | "christmastide" | "lent" | "eastertide";

/**
 * A paid-product content window (start/end inclusive). `calendarDays` is the true
 * inclusive span; `specHeadlineDays` is the number quoted in the locked spec — they
 * DIVERGE for advent (variable 22–28 vs headline 28), lent (46 calendar vs 40 sends
 * excl. Sundays) and eastertide (49 with Pentecost excluded vs headline 50). How the
 * send set is derived inside the window (Sunday handling, free-climax-day overlap) is
 * a Phase C/D decision — this engine only fixes the boundaries.
 */
export interface SeasonWindow {
  key: SeasonKey;
  label: string;
  start: CalDate;
  end: CalDate;
  calendarDays: number;
  specHeadlineDays: number;
}

/** The four paid season windows anchored around `year` (Christmastide ends in year+1). */
export function seasonWindows(year: number): Record<SeasonKey, SeasonWindow> {
  const e = easterCycle(year);
  const c = christmasCycle(year);
  const advent: SeasonWindow = {
    key: "advent",
    label: "Advent",
    start: c.firstSundayOfAdvent,
    end: { year, month: 12, day: 24 },
    calendarDays: daysInclusive(c.firstSundayOfAdvent, { year, month: 12, day: 24 }),
    specHeadlineDays: 28,
  };
  const christmastide: SeasonWindow = {
    key: "christmastide",
    label: "Christmastide",
    start: c.christmasDay,
    end: c.christmastideEnd,
    calendarDays: daysInclusive(c.christmasDay, c.christmastideEnd),
    specHeadlineDays: 12,
  };
  const lent: SeasonWindow = {
    key: "lent",
    label: "Lent (incl. Holy Week)",
    start: e.ashWednesday,
    end: e.holySaturday,
    calendarDays: daysInclusive(e.ashWednesday, e.holySaturday),
    specHeadlineDays: 40,
  };
  // Eastertide product excludes Pentecost itself (Pentecost is a free climax day).
  const eastertide: SeasonWindow = {
    key: "eastertide",
    label: "Eastertide",
    start: e.easterSunday,
    end: addDays(e.pentecost, -1),
    calendarDays: daysInclusive(e.easterSunday, addDays(e.pentecost, -1)),
    specHeadlineDays: 50,
  };
  return { advent, christmastide, lent, eastertide };
}

/** The six free climax days observed in `calendarYear` (sent to the whole base). */
export function freeClimaxDays(calendarYear: number): { label: string; date: CalDate }[] {
  const e = easterCycle(calendarYear);
  return [
    { label: "Christmas Day", date: { year: calendarYear, month: 12, day: 25 } },
    { label: "Epiphany", date: { year: calendarYear, month: 1, day: 6 } },
    { label: "Palm Sunday", date: e.palmSunday },
    { label: "Good Friday", date: e.goodFriday },
    { label: "Easter Sunday", date: e.easterSunday },
    { label: "Pentecost", date: e.pentecost },
  ];
}
