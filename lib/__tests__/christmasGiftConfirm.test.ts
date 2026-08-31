import { describe, expect, it } from "vitest";
import { confirmScheduledGift } from "../christmasGiftConfirm";

/**
 * Mock Supabase admin that returns a scripted sequence of results in call order. The
 * builder is chainable and awaitable (for `.update().eq().select()` which is awaited
 * directly) and also supports `.maybeSingle()` / `.single()`.
 */
function mockAdminSeq(responses: Array<{ data: unknown; error: unknown }>) {
  let i = 0;
  const next = () => responses[i++] ?? { data: null, error: null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {
    from: () => builder,
    update: () => builder,
    insert: () => builder,
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => next(),
    single: async () => next(),
    // Makes the builder awaitable: `await ...update().eq().select()` resolves here.
    then: (resolve: (v: unknown) => void) => resolve(next()),
  };
  return builder;
}

describe("confirmScheduledGift — idempotency / guards", () => {
  it("returns already_confirmed with the existing signup when the claim is lost to a retry", async () => {
    // 1) claim UPDATE ... RETURNING -> 0 rows (another inbound already confirmed)
    // 2) existing lookup -> status confirmed + a pending_signup_id
    const admin = mockAdminSeq([
      { data: [], error: null },
      { data: { status: "confirmed", pending_signup_id: "ps-existing" }, error: null },
    ]);
    const r = await confirmScheduledGift(admin, { consentId: "c1", purchaseId: "p1", replyBody: "YES" });
    expect(r).toEqual({ status: "already_confirmed", pendingSignupId: "ps-existing" });
  });

  it("returns not_pending when the purchase is not in a confirmable state", async () => {
    const admin = mockAdminSeq([
      { data: [], error: null }, // claim -> 0 rows
      { data: { status: "awaiting_release", pending_signup_id: null }, error: null }, // not confirmed
    ]);
    const r = await confirmScheduledGift(admin, { consentId: "c1", purchaseId: "p1", replyBody: "YES" });
    expect(r).toEqual({ status: "not_pending" });
  });

  it("creates the prepaid subscriber on a successful claim (happy path shape)", async () => {
    // 1) claim -> 1 row (the purchase, DMFH bonus on)
    // 2) insert pending_signups -> { id }
    // 3) consent update -> ok
    // 4) purchase link update -> ok
    const admin = mockAdminSeq([
      { data: [{ id: "p1", language: "en", dmfh_bonus_included: true, stripe_customer_id: "cus_1", purchaser_email: "b@x.com", purchaser_user_id: null }], error: null },
      { data: { id: "ps-new" }, error: null },
      { data: null, error: null },
      { data: null, error: null },
    ]);
    const r = await confirmScheduledGift(admin, { consentId: "c1", purchaseId: "p1", replyBody: "YES", nowMs: 1_800_000_000_000 });
    expect(r).toEqual({ status: "confirmed", pendingSignupId: "ps-new" });
  });
});
