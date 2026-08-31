import { describe, it, expect, vi } from "vitest";

vi.mock("../stripe", () => ({ getStripe: () => ({}) }));
vi.mock("../supabaseAdmin", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
  }),
}));

import { onChristmasGiftReferralConversion } from "../referral";

describe("onChristmasGiftReferralConversion", () => {
  it("no_referral (no-op) when the gift purchase has no referral event", async () => {
    const r = await onChristmasGiftReferralConversion({ christmasGiftPurchaseId: "p1", refereeCustomerId: "cus_buyer" });
    expect(r).toEqual({ status: "no_referral" });
  });
});
