import { describe, expect, it } from "vitest";
import { parseMarketingAnalysis } from "../outreach/marketing-analysis";

const valid = {
  executive_summary: "Start with a controlled test.", next_action: "Review the evidence.", data_limitations: ["No IGY conversion data."],
  recommendations: [{
    market_name: "Test Market", state: "KS", center_label: "Wichita, KS", radius_miles: 25, score: 82,
    why_now: "Current public program calendar.", audience: "Youth leaders",
    timing: { start: "2026-09-01", end: "2026-09-14", rationale: "Program-year start." },
    message: { theme: "Useful family routine", value_proposition: "Daily conversation starter", call_to_action: "View the sample", subject_line: "A resource for families", opening: "I wanted to share a resource." },
    channels: ["email"], test_size: 20, success_metrics: ["qualified replies"], risks: ["limited data"], assumptions: ["calendar is current"],
    profile: {
      area_demographics: { population: 100000, median_household_income: 60000 },
      congregation_landscape: { known_congregations: 12 },
      attendee_profile: { sourced_segments: [], limitations: ["No published attendee demographics."] },
      economics: { area_notes: ["Median income is sourced."] },
      public_outreach: { signals: ["Youth program calendar"], opportunities: ["Program-year start"] },
    },
    campaign_strategy: { campaign_type: "church outreach", denomination_filters: ["usccb", "invalid"], size_filters: ["large", "invalid"], discount_percent: 90, investment_cents: 2500, message_variant: "default", rationale: "Start small." },
    evidence: [{ claim: "Program starts in September", url: "https://example.org/calendar" }],
  }],
};

describe("parseMarketingAnalysis", () => {
  it("keeps grounded recommendations and clamps operational limits", () => {
    const analysis = parseMarketingAnalysis({ ...valid, recommendations: [{ ...valid.recommendations[0], radius_miles: 400, test_size: 1000, score: 120 }] }, "2026-08-10T00:00:00.000Z");
    expect(analysis.recommendations[0]).toMatchObject({ radius_miles: 100, test_size: 250, score: 100 });
    expect(analysis.recommendations[0].campaign_strategy).toMatchObject({ denomination_filters: ["usccb"], size_filters: ["large"], discount_percent: 25 });
    expect(analysis.recommendations[0].profile.attendee_profile.limitations).toEqual(["No published attendee demographics."]);
  });

  it("rejects a market recommendation without source evidence", () => {
    expect(() => parseMarketingAnalysis({ ...valid, recommendations: [{ ...valid.recommendations[0], evidence: [] }] })).toThrow("analyst_ungrounded_market_0");
  });
});
