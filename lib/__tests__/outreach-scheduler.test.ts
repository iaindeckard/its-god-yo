import { describe, expect, it } from "vitest";
import { nextReleaseAt, validTimeZone } from "../outreach/schedule-policy";

describe("outreach campaign release policy", () => {
  it("schedules touch two exactly 30 days after the first release instant", () => {
    expect(nextReleaseAt("2026-08-13T10:00:00.000Z")).toBe("2026-09-12T10:00:00.000Z");
  });

  it("accepts IANA timezones and rejects labels that cannot be audited", () => {
    expect(validTimeZone("America/Chicago")).toBe(true);
    expect(validTimeZone("Central time-ish")).toBe(false);
  });
});
