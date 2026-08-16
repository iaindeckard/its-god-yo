import { describe, expect, it } from "vitest";
import { calculateReinvestment, type ReinvestmentPolicy } from "../outreach/reinvestment-core";

const policy: ReinvestmentPolicy = {
  enabled: true, reinvest_rate_bps: 3000, minimum_contacted: 20,
  minimum_conversions: 2, minimum_roi_bps: 1000, maximum_cycle_cents: 50000,
  maximum_campaign_share_bps: 6000,
};

describe("ROI reinvestment", () => {
  it("allocates only to campaigns that clear cost, sample, conversion, profit, and ROI gates", () => {
    const result = calculateReinvestment(policy, [
      { campaign_id: "winner", name: "Winner", invested_cents: 10000, net_revenue_cents: 30000, reinvested_net_revenue_cents: 0, contacted: 40, conversions: 4 },
      { campaign_id: "loss", name: "Loss", invested_cents: 10000, net_revenue_cents: 9000, reinvested_net_revenue_cents: 0, contacted: 40, conversions: 4 },
      { campaign_id: "unknown-cost", name: "Unknown", invested_cents: 0, net_revenue_cents: 50000, reinvested_net_revenue_cents: 0, contacted: 40, conversions: 4 },
      { campaign_id: "thin", name: "Thin", invested_cents: 1000, net_revenue_cents: 5000, reinvested_net_revenue_cents: 0, contacted: 4, conversions: 1 },
    ]);
    expect(result.allocations.map((row) => row.campaign_id)).toEqual(["winner"]);
    expect(result.allocations[0].roi_bps).toBe(20000);
    expect(result.pool_cents).toBe(5400); // 30% pool, constrained by 60% single-market cap
  });

  it("honors the cycle cap and allocates proportionally to realized profit", () => {
    const result = calculateReinvestment({ ...policy, maximum_cycle_cents: 5000, maximum_campaign_share_bps: 10000 }, [
      { campaign_id: "a", name: "A", invested_cents: 1000, net_revenue_cents: 3000, reinvested_net_revenue_cents: 0, contacted: 20, conversions: 2 },
      { campaign_id: "b", name: "B", invested_cents: 1000, net_revenue_cents: 5000, reinvested_net_revenue_cents: 0, contacted: 20, conversions: 2 },
    ]);
    expect(result.pool_cents).toBe(2400);
    expect(result.allocations.map((row) => row.allocated_cents)).toEqual([800, 1600]);
  });

  it("returns no allocations when automatic proposals are paused", () => {
    expect(calculateReinvestment({ ...policy, enabled: false }, [
      { campaign_id: "a", name: "A", invested_cents: 1000, net_revenue_cents: 5000, reinvested_net_revenue_cents: 0, contacted: 20, conversions: 2 },
    ]).allocations).toEqual([]);
  });

  it("never reinvests revenue already consumed by an executed proposal", () => {
    const result = calculateReinvestment(policy, [
      { campaign_id: "a", name: "A", invested_cents: 1000, net_revenue_cents: 5000, reinvested_net_revenue_cents: 5000, contacted: 20, conversions: 2 },
    ]);
    expect(result.pool_cents).toBe(0);
    expect(result.allocations).toEqual([]);
  });
});
