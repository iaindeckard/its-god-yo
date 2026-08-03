import { describe, it, expect } from "vitest";
import { seasonSendDates, orderedDistinctPool } from "../seasons/content";
import { freeClimaxDays, iso, weekday } from "../seasons/liturgical";

describe("orderedDistinctPool — (c) text dedup + spread", () => {
  it("collapses different refs with identical normalized text to one", () => {
    const pool = [
      { ref: "1 Chronicles 16:10", text: "Glory ye in his holy name: let the heart..." },
      { ref: "Psalms 105:3", text: "Glory ye in his holy name: let the heart..." }, // dup text
      { ref: "John 3:16", text: "For God so loved the world" },
    ];
    const out = orderedDistinctPool(pool);
    expect(out.length).toBe(2);
    const texts = out.map((v) => v.text);
    expect(new Set(texts).size).toBe(2);
  });
  it("normalizes punctuation/case when comparing text", () => {
    const out = orderedDistinctPool([
      { ref: "A 1:1", text: "He is Risen!" },
      { ref: "B 2:2", text: "he is risen" },
    ]);
    expect(out.length).toBe(1);
  });
  it("is deterministic and not in ref order (spread, not adjacency)", () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ ref: `Book ${i}:1`, text: `verse number ${i}` }));
    const a = orderedDistinctPool(rows).map((v) => v.ref);
    const b = orderedDistinctPool(rows).map((v) => v.ref);
    expect(a).toEqual(b); // deterministic
    const refOrder = [...rows].map((v) => v.ref);
    expect(a).not.toEqual(refOrder); // shuffled away from ref-adjacent order
  });
});

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
