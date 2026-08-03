import { describe, it, expect } from "vitest";
import { seasonSendDates } from "../seasons/content";
import { freeClimaxDays, iso, weekday } from "../seasons/liturgical";

describe("seasonSendDates — paid-exclusive counts match the build notes", () => {
  it("Christmastide 2026 = 11 (Dec 25 free Christmas excluded)", () => {
    const d = seasonSendDates("christmastide", 2026);
    expect(d.length).toBe(11);
    expect(d.map(iso)).not.toContain("2026-12-25");
  });
  it("Lent 2026 = 39 (6 Sundays + Good Friday excluded)", () => {
    const d = seasonSendDates("lent", 2026);
    expect(d.length).toBe(39);
    expect(d.some((x) => weekday(x) === 0)).toBe(false); // no Sundays
    const goodFri = freeClimaxDays(2026).find((f) => f.label === "Good Friday")!;
    expect(d.map(iso)).not.toContain(iso(goodFri.date)); // Good Friday excluded
  });
  it("Eastertide 2026 = 48 (Easter Sunday free excluded; Pentecost outside window)", () => {
    const d = seasonSendDates("eastertide", 2026);
    expect(d.length).toBe(48);
    expect(d.map(iso)).not.toContain("2026-04-05"); // Easter Sunday
  });
  it("Advent counts are the variable window length (no Sunday skip, no free days inside)", () => {
    for (const y of [2026, 2027, 2028, 2029, 2030]) {
      const n = seasonSendDates("advent", y).length;
      expect(n).toBeGreaterThanOrEqual(22);
      expect(n).toBeLessThanOrEqual(28);
    }
  });
  it("no send date is ever a free climax day, for any season", () => {
    for (const season of ["advent", "christmastide", "lent", "eastertide"] as const) {
      const free = new Set([2025, 2026, 2027].flatMap((y) => freeClimaxDays(y).map((f) => iso(f.date))));
      for (const d of seasonSendDates(season, 2026)) expect(free.has(iso(d))).toBe(false);
    }
  });
});
