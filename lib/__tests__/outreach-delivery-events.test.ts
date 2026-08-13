import { describe, expect, it } from "vitest";
import { eventOccurredAt, lifecycleStatus, providerMessageId } from "../outreach/delivery-events-core";

describe("outreach delivery event normalization", () => {
  it("maps Resend lifecycle events to durable statuses", () => {
    expect(lifecycleStatus("email.sent")).toBe("sent");
    expect(lifecycleStatus("email.delivered")).toBe("delivered");
    expect(lifecycleStatus("email.delivery_delayed")).toBe("delayed");
    expect(lifecycleStatus("email.bounced")).toBe("bounced");
    expect(lifecycleStatus("email.complained")).toBe("complained");
    expect(lifecycleStatus("email.suppressed")).toBe("suppressed");
    expect(lifecycleStatus("email.failed")).toBe("failed");
    expect(lifecycleStatus("email.opened")).toBeNull();
  });

  it("extracts the provider message id from current and fallback payload shapes", () => {
    expect(providerMessageId({ email_id: "msg_primary", id: "msg_fallback" })).toBe("msg_primary");
    expect(providerMessageId({ id: "msg_fallback" })).toBe("msg_fallback");
    expect(providerMessageId({})).toBeNull();
  });

  it("normalizes valid event times and safely falls back", () => {
    expect(eventOccurredAt("2026-08-12T20:30:35Z")).toBe("2026-08-12T20:30:35.000Z");
    expect(eventOccurredAt("invalid", new Date("2026-08-12T21:00:00Z"))).toBe("2026-08-12T21:00:00.000Z");
  });
});
