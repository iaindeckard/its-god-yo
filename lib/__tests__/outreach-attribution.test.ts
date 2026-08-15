import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` is a Next.js import-boundary marker whose default Node entry
// intentionally throws outside React's server condition. The unit under test is
// server code, so mock only that marker; all attribution logic remains real.
vi.mock("server-only", () => ({}));

import {
  OUTREACH_LINK_MAX_AGE,
  outreachAttributionToken,
  readOutreachAttributionCookie,
  verifyOutreachAttributionToken,
} from "../outreach/attribution";

const LEAD_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_LEAD_ID = "22222222-2222-4222-8222-222222222222";
const NOW = 1_800_000_000;
const EXP = NOW + 3600;
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
  it("is deterministic for the same trusted lead, touch, language and expiry", () => {
    expect(outreachAttributionToken(LEAD_ID, 1, "en", EXP)).toBe(outreachAttributionToken(LEAD_ID, 1, "en", EXP));
  });

  it("binds the signature to lead, touch, language and expiry", () => {
    const base = outreachAttributionToken(LEAD_ID, 1, "en", EXP);
    expect(outreachAttributionToken(OTHER_LEAD_ID, 1, "en", EXP)).not.toBe(base);
    expect(outreachAttributionToken(LEAD_ID, 2, "en", EXP)).not.toBe(base);
    expect(outreachAttributionToken(LEAD_ID, 1, "es", EXP)).not.toBe(base);
    expect(outreachAttributionToken(LEAD_ID, 1, "en", EXP + 1)).not.toBe(base);
  });

  it("accepts a valid unexpired token and rejects tampering", () => {
    const token = outreachAttributionToken(LEAD_ID, 2, "en", EXP);
    expect(verifyOutreachAttributionToken(LEAD_ID, 2, "en", EXP, token, NOW)).toBe(true);
    expect(verifyOutreachAttributionToken(LEAD_ID, 1, "en", EXP, token, NOW)).toBe(false);
    expect(verifyOutreachAttributionToken(OTHER_LEAD_ID, 2, "en", EXP, token, NOW)).toBe(false);
    expect(verifyOutreachAttributionToken(LEAD_ID, 2, "en", EXP + 1, token, NOW)).toBe(false);
    expect(verifyOutreachAttributionToken(LEAD_ID, 2, "en", EXP, `${token.slice(0, -1)}0`, NOW)).toBe(false);
  });

  it("rejects expired and policy-extended links", () => {
    const expired = NOW - 1;
    const expiredToken = outreachAttributionToken(LEAD_ID, 1, "en", expired);
    expect(verifyOutreachAttributionToken(LEAD_ID, 1, "en", expired, expiredToken, NOW)).toBe(false);

    const tooFar = NOW + OUTREACH_LINK_MAX_AGE + 61;
    const tooFarToken = outreachAttributionToken(LEAD_ID, 1, "en", tooFar);
    expect(verifyOutreachAttributionToken(LEAD_ID, 1, "en", tooFar, tooFarToken, NOW)).toBe(false);
  });

  it("fails closed when no signing secret is configured", () => {
    delete process.env.OUTREACH_ATTRIBUTION_SECRET;
    delete process.env.OUTREACH_UNSUB_SECRET;
    delete process.env.CRON_SECRET;
    expect(outreachAttributionToken(LEAD_ID, 1, "en", EXP)).toBe("no-secret-set");
    expect(verifyOutreachAttributionToken(LEAD_ID, 1, "en", EXP, "no-secret-set", NOW)).toBe(false);
  });

  it("accepts only UUID-shaped opaque attribution cookies", () => {
    const sessionId = "33333333-3333-4333-8333-333333333333";
    expect(readOutreachAttributionCookie(sessionId)).toBe(sessionId);
    expect(readOutreachAttributionCookie("not-a-session-id")).toBeNull();
    expect(readOutreachAttributionCookie(null)).toBeNull();
  });
});
