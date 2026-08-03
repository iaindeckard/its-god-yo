import { describe, it, expect } from "vitest";
import {
  gregorianEaster,
  easterCycle,
  christmasCycle,
  firstSundayOfAdvent,
  seasonWindows,
  freeClimaxDays,
  iso,
  weekday,
  type CalDate,
} from "../seasons/liturgical";

// Independent cross-check implementation: Gauss's Gregorian Easter algorithm, with
// the two classic correction cases. Deliberately a DIFFERENT derivation from the
// Meeus/Jones/Butcher one in the module, so agreement across centuries is real
// evidence, not the same code twice.
function gaussEaster(Y: number): CalDate {
  const mod = (x: number, n: number) => ((x % n) + n) % n;
  const a = Y % 19;
  const b = Y % 4;
  const c = Y % 7;
  const k = Math.floor(Y / 100);
  const p = Math.floor((13 + 8 * k) / 25);
  const q = Math.floor(k / 4);
  const M = mod(15 - p + k - q, 30);
  const N = mod(4 + k - q, 7);
  const d = mod(19 * a + M, 30);
  const e = mod(2 * b + 4 * c + 6 * d + N, 7);
  if (d === 29 && e === 6) return { year: Y, month: 4, day: 19 };
  if (d === 28 && e === 6 && mod(11 * M + 11, 30) < 19) return { year: Y, month: 4, day: 18 };
  const dd = 22 + d + e;
  return dd > 31 ? { year: Y, month: 4, day: dd - 31 } : { year: Y, month: 3, day: dd };
}

describe("gregorianEaster — cross-check vs an independent Gauss implementation", () => {
  it("agrees with Gauss for every Gregorian year 1583–2600", () => {
    const mismatches: string[] = [];
    for (let y = 1583; y <= 2600; y++) {
      const a = iso(gregorianEaster(y));
      const b = iso(gaussEaster(y));
      if (a !== b) mismatches.push(`${y}: Meeus=${a} Gauss=${b}`);
    }
    expect(mismatches).toEqual([]);
  });

  it("always lands on a Sunday, in the valid 22 Mar – 25 Apr window", () => {
    for (let y = 1583; y <= 2600; y++) {
      const e = gregorianEaster(y);
      expect(weekday(e)).toBe(0); // Sunday
      const inWindow =
        (e.month === 3 && e.day >= 22) || (e.month === 4 && e.day <= 25);
      expect(inWindow, `Easter ${iso(e)} out of window`).toBe(true);
    }
  });
});

describe("gregorianEaster — table of known real Western Easter dates", () => {
  // Verified against published liturgical calendars. Mix of recent years (high
  // confidence) plus the famous extremes: 2008 very early, 2011/2038 very late.
  const KNOWN: Record<number, string> = {
    2000: "2000-04-23",
    2008: "2008-03-23",
    2011: "2011-04-24",
    2016: "2016-03-27",
    2017: "2017-04-16",
    2018: "2018-04-01",
    2019: "2019-04-21",
    2020: "2020-04-12",
    2021: "2021-04-04",
    2022: "2022-04-17",
    2023: "2023-04-09",
    2024: "2024-03-31",
    2025: "2025-04-20",
    2026: "2026-04-05",
    2027: "2027-03-28",
    2030: "2030-04-21",
    2038: "2038-04-25", // latest possible Easter
  };
  for (const [year, date] of Object.entries(KNOWN)) {
    it(`${year} → ${date}`, () => {
      expect(iso(gregorianEaster(Number(year)))).toBe(date);
    });
  }
});

describe("derived Easter-cycle anchors (spot-check 2025, all real dates)", () => {
  const c = easterCycle(2025);
  it("Easter 2025 = Apr 20", () => expect(iso(c.easterSunday)).toBe("2025-04-20"));
  it("Ash Wednesday = Mar 5 (Easter − 46)", () => expect(iso(c.ashWednesday)).toBe("2025-03-05"));
  it("Palm Sunday = Apr 13", () => expect(iso(c.palmSunday)).toBe("2025-04-13"));
  it("Good Friday = Apr 18", () => expect(iso(c.goodFriday)).toBe("2025-04-18"));
  it("Holy Saturday = Apr 19", () => expect(iso(c.holySaturday)).toBe("2025-04-19"));
  it("Pentecost = Jun 8 (Easter + 49)", () => expect(iso(c.pentecost)).toBe("2025-06-08"));
  it("Ash Wednesday and Good Friday fall on the expected weekdays", () => {
    expect(weekday(c.ashWednesday)).toBe(3); // Wednesday
    expect(weekday(c.goodFriday)).toBe(5); // Friday
  });
});

describe("firstSundayOfAdvent — Sunday nearest Nov 30 (real dates)", () => {
  const KNOWN: Record<number, string> = {
    2022: "2022-11-27",
    2023: "2023-12-03",
    2024: "2024-12-01",
    2025: "2025-11-30",
    2026: "2026-11-29",
  };
  for (const [year, date] of Object.entries(KNOWN)) {
    it(`${year} → ${date}`, () => {
      const d = firstSundayOfAdvent(Number(year));
      expect(iso(d)).toBe(date);
      expect(weekday(d)).toBe(0); // Sunday
    });
  }
});

describe("season windows — boundaries + spec-divergence flags", () => {
  const w = seasonWindows(2026);
  it("Christmastide 2026: Dec 25 → Jan 5, exactly 12 days (matches spec)", () => {
    expect(iso(w.christmastide.start)).toBe("2026-12-25");
    expect(iso(w.christmastide.end)).toBe("2027-01-05");
    expect(w.christmastide.calendarDays).toBe(12);
    expect(w.christmastide.calendarDays).toBe(w.christmastide.specHeadlineDays);
  });
  it("Lent 2026: Ash Wed → Holy Sat spans 46 CALENDAR days (spec headline is 40 sends excl. Sundays)", () => {
    expect(w.lent.calendarDays).toBe(46);
    expect(w.lent.specHeadlineDays).toBe(40);
  });
  it("Advent 2026 spans 22–28 days (variable; spec headline 28 is the max case)", () => {
    expect(w.advent.calendarDays).toBeGreaterThanOrEqual(22);
    expect(w.advent.calendarDays).toBeLessThanOrEqual(28);
  });
  it("Eastertide 2026: Easter → day before Pentecost = 49 days (spec headline 50 includes Pentecost)", () => {
    expect(w.eastertide.calendarDays).toBe(49);
    expect(w.eastertide.specHeadlineDays).toBe(50);
  });
});

describe("Epiphany is FIXED on Jan 6 — never transferred (Episcopal/BCP rule)", () => {
  it("is Jan 6 every year, on whatever weekday it falls", () => {
    for (let y = 2024; y <= 2035; y++) {
      const ep = christmasCycle(y).epiphany;
      expect(ep.month).toBe(1);
      expect(ep.day).toBe(6); // fixed — NOT moved to the Sunday of Jan 2–8
      expect(ep.year).toBe(y + 1);
    }
    // In 2026 Epiphany (Jan 6 2026) is a Tuesday; a transferred date would be Jan 4
    // (Sun). Confirm we keep the fixed Tuesday, proving no Sunday-transfer logic.
    const ep2026 = freeClimaxDays(2026).find((d) => d.label === "Epiphany")!;
    expect(iso(ep2026.date)).toBe("2026-01-06");
    expect(weekday(ep2026.date)).toBe(2); // Tuesday
  });
});

describe("freeClimaxDays — six days, correct for 2026", () => {
  const days = freeClimaxDays(2026);
  it("has exactly the six locked climax days", () => {
    expect(days.map((d) => d.label)).toEqual([
      "Christmas Day",
      "Epiphany",
      "Palm Sunday",
      "Good Friday",
      "Easter Sunday",
      "Pentecost",
    ]);
  });
  it("2026 dates are right", () => {
    const byLabel = Object.fromEntries(days.map((d) => [d.label, iso(d.date)]));
    expect(byLabel["Christmas Day"]).toBe("2026-12-25");
    expect(byLabel["Epiphany"]).toBe("2026-01-06");
    expect(byLabel["Easter Sunday"]).toBe("2026-04-05");
    expect(byLabel["Pentecost"]).toBe("2026-05-24");
  });
});
