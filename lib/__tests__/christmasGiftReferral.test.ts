import { describe, it, expect, vi } from "vitest";

vi.mock("../stripe", () => ({ getStripe: () => ({}) }));
vi.mock("../supabaseAdmin", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
  }),
}));

import { onChristmasGiftReferralConversion, flashSaleRewardMultiplier } from "../referral";

describe("onChristmasGiftReferralConversion", () => {
  it("no_referral (no-op) when the gift purchase has no referral event", async () => {
    const r = await onChristmasGiftReferralConversion({ christmasGiftPurchaseId: "p1", refereeCustomerId: "cus_buyer" });
    expect(r).toEqual({ status: "no_referral" });
  });
});

describe("flashSaleRewardMultiplier", () => {
  it("doubles for a flash_sale purchase, standard otherwise", () => {
    expect(flashSaleRewardMultiplier("flash_sale")).toBe(2);
    expect(flashSaleRewardMultiplier("early_bird")).toBe(1);
    expect(flashSaleRewardMultiplier("standard")).toBe(1);
    expect(flashSaleRewardMultiplier(null)).toBe(1);
    expect(flashSaleRewardMultiplier(undefined)).toBe(1);
  });
});
