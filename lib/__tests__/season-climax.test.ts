import { describe, it, expect } from "vitest";
import { climaxDayFor } from "../seasons/climax";
import { seasonSendDates } from "../seasons/content";
import { freeClimaxDays, iso } from "../seasons/liturgical";

describe("climaxDayFor — identifies the six climax days, nothing else", () => {
  it("Christmas Day / Epiphany (fixed) and the Easter-cycle four (2027)", () => {
    expect(climaxDayFor({ year: 2026, month: 12, day: 25 })?.key).toBe("christmas_day");
    expect(climaxDayFor({ year: 2026, month: 1, day: 6 })?.key).toBe("epiphany");
    expect(climaxDayFor({ year: 2027, month: 3, day: 28 })?.key).toBe("easter_sunday"); // Easter 2027
    const gf = freeClimaxDays(2027).find((d) => d.label === "Good Friday")!;
    expect(climaxDayFor(gf.date)?.key).toBe("good_friday");
  });
  it("no-ops for ordinary days", () => {
    expect(climaxDayFor({ year: 2026, month: 6, day: 1 })).toBeNull();
    expect(climaxDayFor({ year: 2026, month: 12, day: 26 })).toBeNull(); // day after Christmas
  });
});

describe("never-double-message: paid season windows EXCLUDE every climax day", () => {
  it("no climax date appears in any season's send dates", () => {
    for (const [season, year] of [["christmastide", 2026], ["lent", 2027], ["eastertide", 2027], ["advent", 2026]] as const) {
      const sends = new Set(seasonSendDates(season, year).map(iso));
      const climaxDates = [2026, 2027].flatMap((y) => freeClimaxDays(y).map((d) => iso(d.date)));
      for (const cd of climaxDates) expect(sends.has(cd), `${season} ${year} must not send on climax ${cd}`).toBe(false);
    }
  });
});
