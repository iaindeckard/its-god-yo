import { describe, expect, it } from "vitest";
import { hasAudienceBlocker, nextReleaseAt, touchTwoReleaseAt, validTimeZone } from "../outreach/schedule-policy";

describe("outreach campaign release policy", () => {
  it("schedules touch two exactly 30 days after the first release instant", () => {
    expect(nextReleaseAt("2026-08-13T10:00:00.000Z")).toBe("2026-09-12T10:00:00.000Z");
  });

  it("anchors touch two on actual send completion, not the (possibly stale) scheduled release", () => {
    const scheduled = "2026-08-01T12:00:00.000Z"; // when touch 1 was SCHEDULED
    const actuallySent = "2026-08-20T09:30:00.000Z"; // when it ACTUALLY fired (a closed gate delayed it 19 days)
    // touchTwoReleaseAt takes only the completion instant by design — 30 days from
    // real send, never from the stale scheduled time.
    expect(touchTwoReleaseAt(actuallySent)).toBe("2026-09-19T09:30:00.000Z");
    expect(touchTwoReleaseAt(actuallySent)).not.toBe(nextReleaseAt(scheduled));
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
