import { describe, it, expect } from "vitest";
import { resolveWindow, validateReleaseDate, type ChristmasConfig } from "../christmasGift";

// America/Chicago literals as stored (UTC) — mirrors the seeded config row.
const base: ChristmasConfig = {
  campaign_active: true,
  sale_opens_at: "2026-09-01T05:00:00.000Z", // Sept 1 00:00 CT
  early_bird_cutoff_at: "2026-11-27T05:59:59.000Z", // Nov 26 23:59:59 CT
  flash_sale_starts_at: "2026-11-27T06:00:00.000Z", // Nov 27 00:00 CT
  flash_sale_ends_at: "2026-12-04T05:59:59.000Z", // Dec 3 23:59:59 CT
  campaign_closes_at: "2026-12-23T05:59:59.000Z", // Dec 22 23:59:59 CT
  max_release_at: "2026-12-25",
  flash_sale_discount_pct: 20,
  list_price_cents: 5900,
};

const at = (iso: string) => Date.parse(iso);

describe("resolveWindow — pricing + gating", () => {
  it("early_bird: list price, DMFH bonus true", () => {
    const r = resolveWindow(base, at("2026-10-01T12:00:00Z"));
    expect(r).toEqual({ ok: true, window: "early_bird", listCents: 5900, chargedCents: 5900, dmfhBonus: true });
  });

  it("flash_sale: 20% off (4720), DMFH bonus true", () => {
    const r = resolveWindow(base, at("2026-11-29T12:00:00Z"));
    expect(r).toEqual({ ok: true, window: "flash_sale", listCents: 5900, chargedCents: 4720, dmfhBonus: true });
  });

  it("standard: list price, no DMFH bonus", () => {
    const r = resolveWindow(base, at("2026-12-10T12:00:00Z"));
    expect(r).toEqual({ ok: true, window: "standard", listCents: 5900, chargedCents: 5900, dmfhBonus: false });
  });

  it("boundary: exactly early-bird cutoff is still early_bird", () => {
    const r = resolveWindow(base, at("2026-11-27T05:59:59.000Z"));
    expect(r.ok && r.window).toBe("early_bird");
  });

  it("boundary: exactly flash-sale start is flash_sale", () => {
    const r = resolveWindow(base, at("2026-11-27T06:00:00.000Z"));
    expect(r.ok && r.window).toBe("flash_sale");
  });

  it("FAIL CLOSED: campaign_active=false -> campaign_inactive", () => {
    expect(resolveWindow({ ...base, campaign_active: false }, at("2026-10-01T12:00:00Z")))
      .toEqual({ ok: false, reason: "campaign_inactive" });
  });

  it("FAIL CLOSED: before sale opens -> sale_not_open", () => {
    expect(resolveWindow(base, at("2026-08-31T12:00:00Z"))).toEqual({ ok: false, reason: "sale_not_open" });
  });

  it("FAIL CLOSED: after campaign close -> campaign_closed", () => {
    expect(resolveWindow(base, at("2026-12-24T12:00:00Z"))).toEqual({ ok: false, reason: "campaign_closed" });
  });

  it("FAIL CLOSED: null config -> config_missing", () => {
    expect(resolveWindow(null, at("2026-10-01T12:00:00Z"))).toEqual({ ok: false, reason: "config_missing" });
  });

  it("FAIL CLOSED: incomplete dates -> config_dates_incomplete", () => {
    expect(resolveWindow({ ...base, flash_sale_starts_at: null }, at("2026-10-01T12:00:00Z")))
      .toEqual({ ok: false, reason: "config_dates_incomplete" });
  });

  it("FAIL CLOSED: misordered windows -> config_window_order_invalid", () => {
    // flash start before early-bird cutoff => not monotonic
    const bad = { ...base, flash_sale_starts_at: "2026-11-01T06:00:00.000Z" };
    expect(resolveWindow(bad, at("2026-11-29T12:00:00Z"))).toEqual({ ok: false, reason: "config_window_order_invalid" });
  });

  it("FAIL CLOSED: invalid discount -> config_discount_invalid", () => {
    expect(resolveWindow({ ...base, flash_sale_discount_pct: 150 }, at("2026-11-29T12:00:00Z")))
      .toEqual({ ok: false, reason: "config_discount_invalid" });
  });

  it("rounds the discounted amount to the nearest cent", () => {
    // 5900 * 0.85 = 5015 exactly; 5899 * 0.85 = 5014.15 -> 5014
    expect(resolveWindow({ ...base, flash_sale_discount_pct: 15 }, at("2026-11-29T12:00:00Z")))
      .toMatchObject({ chargedCents: 5015 });
    expect(resolveWindow({ ...base, flash_sale_discount_pct: 15, list_price_cents: 5899 }, at("2026-11-29T12:00:00Z")))
      .toMatchObject({ chargedCents: 5014 });
  });
});

describe("validateReleaseDate", () => {
  const now = at("2026-10-01T12:00:00Z");
  it("accepts a future date within the max", () => {
    expect(validateReleaseDate("2026-12-24", base, now)).toEqual({ ok: true, releaseDate: "2026-12-24" });
  });
  it("rejects today / past", () => {
    expect(validateReleaseDate("2026-10-01", base, now)).toEqual({ ok: false, reason: "release_date_not_future" });
    expect(validateReleaseDate("2026-09-15", base, now)).toEqual({ ok: false, reason: "release_date_not_future" });
  });
  it("rejects after max_release_at", () => {
    expect(validateReleaseDate("2026-12-26", base, now)).toEqual({ ok: false, reason: "release_date_after_max" });
  });
  it("rejects malformed", () => {
    expect(validateReleaseDate("12/25/2026", base, now)).toEqual({ ok: false, reason: "release_date_malformed" });
  });
});
