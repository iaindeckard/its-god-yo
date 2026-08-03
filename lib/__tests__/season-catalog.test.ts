import { describe, it, expect } from "vitest";
import { SEASON_PRODUCTS, SEASON_KEYS, seasonPriceLabel } from "../seasons/catalog";

describe("season catalog — matches the locked spec prices", () => {
  it("covers exactly the four locked products", () => {
    expect([...SEASON_KEYS].sort()).toEqual(["advent", "christmastide", "eastertide", "lent"]);
  });
  it("per-teen amounts match the spec", () => {
    expect(seasonPriceLabel("christmastide")).toBe("$4.99");
    expect(seasonPriceLabel("advent")).toBe("$7.99");
    expect(seasonPriceLabel("eastertide")).toBe("$9.99");
    expect(seasonPriceLabel("lent")).toBe("$12.99");
  });
  it("every product has a lookup key and a resolvable (test-fallback) price id", () => {
    for (const k of SEASON_KEYS) {
      const p = SEASON_PRODUCTS[k];
      expect(p.lookupKey).toBe(`igy_season_${k}`);
      expect(p.priceId).toMatch(/^price_/);
    }
  });
});
