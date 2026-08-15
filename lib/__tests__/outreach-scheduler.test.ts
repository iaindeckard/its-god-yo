import { describe, expect, it } from "vitest";
import { hasAudienceBlocker, nextReleaseAt, validTimeZone } from "../outreach/schedule-policy";

describe("outreach campaign release policy", () => {
  it("schedules touch two exactly 30 days after the first release instant", () => {
    expect(nextReleaseAt("2026-08-13T10:00:00.000Z")).toBe("2026-09-12T10:00:00.000Z");
  });

  it("accepts IANA timezones and rejects labels that cannot be audited", () => {
    expect(validTimeZone("America/Chicago")).toBe(true);
    expect(validTimeZone("Central time-ish")).toBe(false);
  });

  it("pauses cadence when an approved recipient is blocked at runtime", () => {
    expect(hasAudienceBlocker([{ outcome: "sent" }, { outcome: "skipped_allowlist" }])).toBe(true);
    expect(hasAudienceBlocker([{ outcome: "sent" }, { outcome: "skipped_unverified" }])).toBe(true);
    expect(hasAudienceBlocker([{ outcome: "sent" }, { outcome: "already_claimed" }])).toBe(false);
  });
});
