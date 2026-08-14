import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  outreachAttributionToken,
  readOutreachAttributionCookie,
  verifyOutreachAttributionToken,
} from "../outreach/attribution";

const LEAD_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_LEAD_ID = "22222222-2222-4222-8222-222222222222";
const originalDedicated = process.env.OUTREACH_ATTRIBUTION_SECRET;
const originalUnsub = process.env.OUTREACH_UNSUB_SECRET;
const originalCron = process.env.CRON_SECRET;

beforeEach(() => {
  process.env.OUTREACH_ATTRIBUTION_SECRET = "unit-test-attribution-secret";
  delete process.env.OUTREACH_UNSUB_SECRET;
  delete process.env.CRON_SECRET;
});

afterEach(() => {
  if (originalDedicated === undefined) delete process.env.OUTREACH_ATTRIBUTION_SECRET;
  else process.env.OUTREACH_ATTRIBUTION_SECRET = originalDedicated;
  if (originalUnsub === undefined) delete process.env.OUTREACH_UNSUB_SECRET;
  else process.env.OUTREACH_UNSUB_SECRET = originalUnsub;
  if (originalCron === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalCron;
});

describe("outreach attribution tokens", () => {
  it("is deterministic for the same trusted lead, touch and language", () => {
    expect(outreachAttributionToken(LEAD_ID, 1, "en")).toBe(outreachAttributionToken(LEAD_ID, 1, "en"));
  });

  it("binds the signature to lead, touch and language", () => {
    const base = outreachAttributionToken(LEAD_ID, 1, "en");
    expect(outreachAttributionToken(OTHER_LEAD_ID, 1, "en")).not.toBe(base);
    expect(outreachAttributionToken(LEAD_ID, 2, "en")).not.toBe(base);
    expect(outreachAttributionToken(LEAD_ID, 1, "es")).not.toBe(base);
  });

  it("accepts the valid token and rejects tampering", () => {
    const token = outreachAttributionToken(LEAD_ID, 2, "en");
    expect(verifyOutreachAttributionToken(LEAD_ID, 2, "en", token)).toBe(true);
    expect(verifyOutreachAttributionToken(LEAD_ID, 1, "en", token)).toBe(false);
    expect(verifyOutreachAttributionToken(OTHER_LEAD_ID, 2, "en", token)).toBe(false);
    expect(verifyOutreachAttributionToken(LEAD_ID, 2, "en", `${token.slice(0, -1)}0`)).toBe(false);
  });

  it("fails closed when no signing secret is configured", () => {
    delete process.env.OUTREACH_ATTRIBUTION_SECRET;
    delete process.env.OUTREACH_UNSUB_SECRET;
    delete process.env.CRON_SECRET;
    expect(outreachAttributionToken(LEAD_ID, 1, "en")).toBe("no-secret-set");
    expect(verifyOutreachAttributionToken(LEAD_ID, 1, "en", "no-secret-set")).toBe(false);
  });

  it("accepts only UUID-shaped opaque attribution cookies", () => {
    const sessionId = "33333333-3333-4333-8333-333333333333";
    expect(readOutreachAttributionCookie(sessionId)).toBe(sessionId);
    expect(readOutreachAttributionCookie("not-a-session-id")).toBeNull();
    expect(readOutreachAttributionCookie(null)).toBeNull();
  });
});
