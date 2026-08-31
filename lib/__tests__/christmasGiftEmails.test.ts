import { describe, it, expect } from "vitest";
import { nonConfirmationCreditEmail, ageGateFailureCreditEmail, christmasGiftReceiptEmail } from "../christmasGiftEmails";

describe("christmas gift credit emails", () => {
  it("non-confirmation: subject, amount, recipient name, credit language", () => {
    const e = nonConfirmationCreditEmail({ purchaserFirstName: "Sam", recipientFirstName: "Alex", amountCents: 5900 });
    expect(e.subject).toBe("Your It's God, Yo! gift has been converted to account credit");
    expect(e.text).toContain("Hi Sam,");
    expect(e.text).toContain("Alex");
    expect(e.text).toContain("$59.00");
    expect(e.text).toContain("account credit");
    expect(e.text).toContain("did not receive a reply");
    expect(e.html).toContain("$59.00");
  });

  it("age-gate: distinct subject + specific reason, discounted amount, no 'no reply' language", () => {
    const e = ageGateFailureCreditEmail({ purchaserFirstName: null, recipientFirstName: "Alex", amountCents: 4720 });
    expect(e.subject).toBe("About your It's God, Yo! gift for Alex");
    expect(e.text).toContain("Hi there,"); // null purchaser -> "there"
    expect(e.text).toContain("age and consent requirements");
    expect(e.text).toContain("$47.20");
    expect(e.text).not.toContain("did not receive a reply");
  });

  it("falls back to 'your recipient' when the recipient name is missing", () => {
    const e = nonConfirmationCreditEmail({ amountCents: 100 });
    expect(e.text).toContain("your recipient");
    expect(e.subject).toContain("account credit");
  });
});

describe("christmasGiftReceiptEmail", () => {
  it("flash sale: shows charged, list price + savings, DMFH bonus, and release date", () => {
    const e = christmasGiftReceiptEmail({
      purchaserFirstName: "Sam", recipientFirstName: "Alex",
      chargedCents: 4720, listCents: 5900, purchaseWindow: "flash_sale", dmfhBonus: true, releaseAt: "2026-12-24",
    });
    expect(e.subject).toBe("Your It's God, Yo! Christmas gift is confirmed");
    expect(e.text).toContain("Charged today: $47.20");
    expect(e.text).toContain("List price $59.00, you saved $11.80 (Black Friday special).");
    expect(e.text).toContain("Includes DM from Him free for the gifted year.");
    expect(e.text).toContain("2026-12-24");
    expect(e.text).toContain("no free trial");
  });

  it("standard: no savings line, no DMFH line", () => {
    const e = christmasGiftReceiptEmail({
      purchaserFirstName: "Sam", recipientFirstName: "Alex",
      chargedCents: 5900, listCents: 5900, purchaseWindow: "standard", dmfhBonus: false, releaseAt: "2026-12-20",
    });
    expect(e.text).toContain("Charged today: $59.00");
    expect(e.text).not.toContain("you saved");
    expect(e.text).not.toContain("DM from Him free");
  });
});
