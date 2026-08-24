import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { bounceStatsFromDeliveries } from "../outreach/deliveries";
import { shouldFireBounceAlert } from "../outreach/alerts";

describe("bounceStatsFromDeliveries", () => {
  it("uses dispatched deliveries (sent_at set) as the denominator", () => {
    const stats = bounceStatsFromDeliveries([
      { sent_at: "t", status: "delivered" },
      { sent_at: "t", status: "bounced" },
      { sent_at: null, status: "claimed" }, // never dispatched — excluded from denominator
    ]);
    expect(stats).toEqual({ sent: 2, bounced: 1, rate: 0.5 });
  });

  it("does not count a recovered (now delivered) message as bounced", () => {
    const stats = bounceStatsFromDeliveries([
      { sent_at: "t", status: "delivered" },
      { sent_at: "t", status: "delivered" },
    ]);
    expect(stats.bounced).toBe(0);
    expect(stats.rate).toBe(0);
  });

  it("reports a zero rate when nothing has been dispatched", () => {
    expect(bounceStatsFromDeliveries([{ sent_at: null, status: "claimed" }])).toEqual({ sent: 0, bounced: 0, rate: 0 });
  });
});

describe("shouldFireBounceAlert (15% threshold, 20-send floor)", () => {
  it("does not evaluate below the sample floor, even at 100%", () => {
    expect(shouldFireBounceAlert({ sent: 19, bounced: 19 })).toBe(false);
  });

  it("fires at or above the threshold once the floor is met", () => {
    expect(shouldFireBounceAlert({ sent: 20, bounced: 3 })).toBe(true); // exactly 15%
    expect(shouldFireBounceAlert({ sent: 100, bounced: 25 })).toBe(true); // 25%
  });

  it("stays silent below the threshold at or above the floor", () => {
    expect(shouldFireBounceAlert({ sent: 20, bounced: 2 })).toBe(false); // 10%
    expect(shouldFireBounceAlert({ sent: 21, bounced: 2 })).toBe(false); // ~9.5% — the Aug 24 Edmond case
  });

  it("honors explicit threshold/floor overrides", () => {
    expect(shouldFireBounceAlert({ sent: 10, bounced: 2 }, { minSample: 5, threshold: 0.2 })).toBe(true);
    expect(shouldFireBounceAlert({ sent: 10, bounced: 1 }, { minSample: 5, threshold: 0.2 })).toBe(false);
  });
});
