import { describe, it, expect } from "vitest";
import { nonConfirmationCreditEmail, ageGateFailureCreditEmail } from "../christmasGiftEmails";

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
