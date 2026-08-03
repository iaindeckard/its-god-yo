import { describe, it, expect } from "vitest";
import { dueOccurrence, SEASON_CHARGE_LEAD_DAYS } from "../seasons/billing";
import { seasonWindows, addDays, iso } from "../seasons/liturgical";

// Advent 2026 starts 2026-11-29 → charge window is [Nov 26, Nov 29] at lead=3.
const adventStart = seasonWindows(2026).advent.start; // 2026-11-29

describe("dueOccurrence — charge window is [seasonStart − lead, seasonStart]", () => {
  const L = SEASON_CHARGE_LEAD_DAYS;
  it("fires on the charge date (seasonStart − lead)", () => {
    const occ = dueOccurrence("advent", addDays(adventStart, -L), L);
    expect(occ).not.toBeNull();
    expect(occ!.seasonYear).toBe(2026);
    expect(iso(occ!.chargeDate)).toBe("2026-11-26");
    expect(iso(occ!.seasonStart)).toBe("2026-11-29");
  });
  it("fires on the last day of the window (seasonStart itself)", () => {
    expect(dueOccurrence("advent", adventStart, L)).not.toBeNull();
  });
  it("no-ops the day BEFORE the window opens", () => {
    expect(dueOccurrence("advent", addDays(adventStart, -L - 1), L)).toBeNull();
  });
  it("no-ops the day AFTER the season has started", () => {
    expect(dueOccurrence("advent", addDays(adventStart, 1), L)).toBeNull();
  });
  it("no-ops far outside any window (mid-June)", () => {
    expect(dueOccurrence("advent", { year: 2026, month: 6, day: 1 }, L)).toBeNull();
  });
  it("handles the Dec→Jan boundary: Christmastide charge fires in late December", () => {
    const xStart = seasonWindows(2026).christmastide.start; // 2026-12-25
    const occ = dueOccurrence("christmastide", addDays(xStart, -L), L);
    expect(occ).not.toBeNull();
    expect(occ!.seasonYear).toBe(2026);
    expect(iso(occ!.chargeDate)).toBe("2026-12-22");
  });
});
