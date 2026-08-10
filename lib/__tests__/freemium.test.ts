import { describe, expect, it } from "vitest";
import { freemiumDeliveryAllowed, localWeekday } from "../freemium";

describe("freemium delivery cadence", () => {
  const mondayUtcNoon = Date.UTC(2026, 7, 10, 12);
  it("computes the recipient's local weekday", () => expect(localWeekday(mondayUtcNoon, "America/Chicago")).toBe(1));
  it("keeps current behavior while the feature is off", () => expect(freemiumDeliveryAllowed({ enabled: false, tier: "free_weekly", weeklySendDow: 3, nowMs: mondayUtcNoon, timezone: "America/Chicago" })).toBe(true));
  it("limits weekly recipients to their delivery day", () => {
    expect(freemiumDeliveryAllowed({ enabled: true, tier: "free_weekly", weeklySendDow: 1, nowMs: mondayUtcNoon, timezone: "America/Chicago" })).toBe(true);
    expect(freemiumDeliveryAllowed({ enabled: true, tier: "free_weekly", weeklySendDow: 2, nowMs: mondayUtcNoon, timezone: "America/Chicago" })).toBe(false);
  });
});
