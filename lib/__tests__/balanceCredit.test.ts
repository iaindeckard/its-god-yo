import { describe, expect, it, vi } from "vitest";

const createBalanceTransaction = vi.fn(async () => ({ id: "cbtxn_123", livemode: false }));
vi.mock("../stripe", () => ({
  getStripe: () => ({ customers: { createBalanceTransaction } }),
}));

import { issueBalanceCredit } from "../balanceCredit";

describe("issueBalanceCredit", () => {
  it("credit -> negative amount; passes currency/description/metadata/idempotency; returns txn id", async () => {
    createBalanceTransaction.mockClear();
    const r = await issueBalanceCredit({
      customerId: "cus_1",
      cents: 4720,
      direction: "credit",
      currency: "usd",
      description: "IGY Christmas gift credit",
      idempotencyKey: "xmas_credit_p1",
      metadata: { purpose: "christmas_gift_2026" },
    });
    expect(r).toEqual({ balanceTransactionId: "cbtxn_123", livemode: false });
    expect(createBalanceTransaction).toHaveBeenCalledWith(
      "cus_1",
      { amount: -4720, currency: "usd", description: "IGY Christmas gift credit", metadata: { purpose: "christmas_gift_2026" } },
      { idempotencyKey: "xmas_credit_p1" },
    );
  });

  it("debit -> positive amount (clawback); empty metadata defaults to {}", async () => {
    createBalanceTransaction.mockClear();
    await issueBalanceCredit({
      customerId: "cus_2",
      cents: 500,
      direction: "debit",
      currency: "usd",
      description: "clawback",
      idempotencyKey: "k2",
    });
    expect(createBalanceTransaction).toHaveBeenCalledWith(
      "cus_2",
      { amount: 500, currency: "usd", description: "clawback", metadata: {} },
      { idempotencyKey: "k2" },
    );
  });

  it("uses the magnitude regardless of a signed cents input", async () => {
    createBalanceTransaction.mockClear();
    await issueBalanceCredit({ customerId: "c", cents: -100, direction: "credit", currency: "usd", description: "d", idempotencyKey: "k" });
    // -Math.abs(-100) = -100 (credit stays negative even if caller passed a negative)
    expect(createBalanceTransaction).toHaveBeenLastCalledWith("c", expect.objectContaining({ amount: -100 }), { idempotencyKey: "k" });
  });
});
