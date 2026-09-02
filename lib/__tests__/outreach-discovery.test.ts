import { afterAll, describe, expect, it } from "vitest";
import {
  boundedDiscoveryMaxRounds,
  boundedProviderItems,
  discoveryErrorStatus,
  discoveryIsComplete,
  discoveryPrimaryProvider,
  extractDiscoveryJson,
  isCreditExhaustedError,
  providerResponsePhase,
  normalizeUsStateCode,
} from "../outreach/discovery-core";
import {
  OFFICIAL_CHURCH_DIRECTORIES,
  applyDirectorySourcePolicy,
  discoverySourceLane,
  discoverySourceLaneCount,
  validDirectoryIds,
  officialDirectoryForUrl,
} from "../outreach/directory-sources";

describe("outreach discovery core", () => {
  it("keeps new run limits inside the persisted 1-to-20 constraint", () => {
    expect(boundedDiscoveryMaxRounds(35, 2, 8)).toBe(20);
    expect(boundedDiscoveryMaxRounds(10, 2, 8)).toBe(13);
    expect(boundedDiscoveryMaxRounds(0, 0, 0)).toBe(1);
  });

  it("mechanically caps provider items even when the model exceeds its prompt", () => {
    expect(boundedProviderItems([1, 2, 3, 4], 2)).toEqual([1, 2]);
    expect(boundedProviderItems([1, 2], undefined)).toEqual([1, 2]);
    expect(boundedProviderItems([1, 2], -1)).toEqual([]);
  });

  it("parses strict and fenced lead payloads", () => {
    const payload = '{"leads":[{"org_name":"First Church","contact_email":"info@example.org"}]}';
    expect(extractDiscoveryJson(payload)?.leads).toHaveLength(1);
    expect(extractDiscoveryJson(`\`\`\`json\n${payload}\n\`\`\``)?.leads[0].org_name).toBe("First Church");
  });

  it("continues while useful work remains", () => {
    expect(discoveryIsComplete({ found: 10, target: 35, round: 2, maxRounds: 8, emptyStreak: 0 })).toBe(false);
  });

  it("stops at target, round ceiling, or two empty rounds", () => {
    expect(discoveryIsComplete({ found: 35, target: 35, round: 3, maxRounds: 8, emptyStreak: 0 })).toBe(true);
    expect(discoveryIsComplete({ found: 5, target: 35, round: 8, maxRounds: 8, emptyStreak: 0 })).toBe(true);
    expect(discoveryIsComplete({ found: 5, target: 35, round: 3, maxRounds: 8, emptyStreak: 2 })).toBe(true);
  });

  it("can require a full source cycle before stopping on empty rounds", () => {
    expect(discoveryIsComplete({
      found: 0, target: 35, round: 7, maxRounds: 26, emptyStreak: 7, emptyStreakLimit: 8,
    })).toBe(false);
    expect(discoveryIsComplete({
      found: 0, target: 35, round: 8, maxRounds: 26, emptyStreak: 8, emptyStreakLimit: 8,
    })).toBe(true);
  });

  it("keeps durable results when a later provider round times out", () => {
    expect(discoveryErrorStatus(15)).toBe("completed");
    expect(discoveryErrorStatus(0)).toBe("failed");
  });

  it("classifies background provider response states", () => {
    expect(providerResponsePhase("queued")).toBe("pending");
    expect(providerResponsePhase("in_progress")).toBe("pending");
    expect(providerResponsePhase("completed")).toBe("completed");
    expect(providerResponsePhase("failed")).toBe("failed");
    expect(providerResponsePhase("cancelled")).toBe("failed");
  });

  it("normalizes state names and abbreviations for statewide targeting", () => {
    expect(normalizeUsStateCode("Florida")).toBe("FL");
    expect(normalizeUsStateCode("fl")).toBe("FL");
    expect(normalizeUsStateCode("District of Columbia")).toBe("DC");
    expect(normalizeUsStateCode("not a state")).toBeNull();
  });

  it("recognizes official national directory subdomains", () => {
    expect(OFFICIAL_CHURCH_DIRECTORIES.length).toBeGreaterThanOrEqual(7);
    expect(officialDirectoryForUrl("https://churches.sbc.net/church/123")?.id).toBe("sbc");
    expect(officialDirectoryForUrl("https://example.com/churches")).toBeNull();
  });

  it("assigns one official directory per round, then a secondary fallback", () => {
    expect(discoverySourceLane(0).directory?.id).toBe("usccb");
    expect(discoverySourceLane(6).directory?.id).toBe("lcms");
    expect(discoverySourceLane(7).directory).toBeNull();
    expect(discoverySourceLane(8).directory?.id).toBe("usccb");
  });

  it("restricts targeted campaigns to their selected official directories", () => {
    expect(validDirectoryIds(["episcopal", "bogus", "episcopal"])).toEqual(["episcopal"]);
    expect(discoverySourceLaneCount(["episcopal"])).toBe(1);
    expect(discoverySourceLane(0, ["episcopal"]).directory?.id).toBe("episcopal");
    expect(discoverySourceLane(4, ["episcopal"]).directory?.id).toBe("episcopal");
    expect(discoverySourceLane(0, ["episcopal"]).label).toContain("episcopalchurch.org");
  });

  it("keeps the Spanish directory out of the default English rotation", () => {
    // English default lanes = general directories + a secondary-web fallback; the
    // Spanish-scoped directory never appears.
    const englishIds = Array.from({ length: discoverySourceLaneCount(null) }, (_, i) =>
      discoverySourceLane(i, null).directory?.id ?? "secondary");
    expect(englishIds).not.toContain("cdusa-spanish");
    expect(englishIds).toContain("secondary");
  });

  it("leads a Spanish campaign with the Spanish directory + secondary fallback only", () => {
    // No denomination filter: Spanish directory, then secondary web. Two lanes.
    expect(discoverySourceLaneCount(null, "es")).toBe(2);
    expect(discoverySourceLane(0, null, "es").directory?.id).toBe("cdusa-spanish");
    expect(discoverySourceLane(0, null, "es").label).toContain("churchdirectoryusa.com");
    expect(discoverySourceLane(1, null, "es").directory).toBeNull();
    expect(discoverySourceLane(2, null, "es").directory?.id).toBe("cdusa-spanish"); // cycles
  });

  it("folds an explicitly selected denomination into a Spanish campaign (Catholic + Spanish)", () => {
    // Spanish directory first, then the campaign's chosen USCCB lane, then secondary.
    expect(discoverySourceLaneCount(["usccb"], "es")).toBe(3);
    expect(discoverySourceLane(0, ["usccb"], "es").directory?.id).toBe("cdusa-spanish");
    expect(discoverySourceLane(1, ["usccb"], "es").directory?.id).toBe("usccb");
    expect(discoverySourceLane(2, ["usccb"], "es").directory).toBeNull();
  });

  it("preserves truthful contact-first evidence plus official-directory provenance", () => {
    const lead = applyDirectorySourcePolicy({
      org_name: "First Church",
      contact_email: "office@first.example",
      directory_source_url: "https://www.umc.org/en/find-a-church/church/1",
      contact_source_url: "https://first.example/contact",
      youth_source_url: "https://first.example/students",
      source_urls: ["https://first.example/contact"],
      discovery_method: "official_directory",
      discovery_confidence: "high",
    });
    expect(lead?.discovery_method).toBe("official_directory");
    expect(lead?.source_urls).toEqual([
      "https://first.example/contact",
      "https://first.example/students",
      "https://www.umc.org/en/find-a-church/church/1",
    ]);
  });

  it("downgrades false directory claims and rejects missing qualification evidence", () => {
    const lead = applyDirectorySourcePolicy({
      org_name: "Second Church",
      contact_email: "info@second.example",
      directory_source_url: "https://maps.example/church/2",
      contact_source_url: "https://second.example/contact",
      youth_source_url: "https://second.example/youth",
      discovery_method: "official_directory",
      discovery_confidence: "high",
    });
    expect(lead?.directory_source_url).toBeNull();
    expect(lead?.discovery_method).toBe("secondary_web");
    expect(lead?.discovery_confidence).toBe("medium");
    expect(applyDirectorySourcePolicy({
      org_name: "No Evidence Church",
      contact_email: "office@missing.example",
      contact_source_url: "https://missing.example/contact",
      youth_source_url: null,
    })).toBeNull();
  });
});

describe("isCreditExhaustedError (failover trigger)", () => {
  it("matches OpenAI credit-exhaustion (insufficient_quota / credit_balance_exhausted)", () => {
    expect(isCreditExhaustedError(new Error(
      'openai_429: {"error":{"message":"You have no credits remaining.","type":"insufficient_quota","code":"credit_balance_exhausted"}}',
    ))).toBe(true);
  });
  it("matches OpenAI's bare prepaid message with NO type/code (async background failure)", () => {
    // This is the exact shape a drained background job surfaces: only the message
    // text, no insufficient_quota/credit_balance_exhausted to key off. Regression
    // guard for the hard-stop bug — before the fix this returned false.
    expect(isCreditExhaustedError(new Error(
      "openai_background_You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.",
    ))).toBe(true);
    expect(isCreditExhaustedError(new Error(
      "openai_background_You exceeded your current quota, please check your plan and billing details.",
    ))).toBe(true);
  });
  it("matches Anthropic 'credit balance is too low'", () => {
    expect(isCreditExhaustedError(new Error(
      'anthropic_400: {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}',
    ))).toBe(true);
    expect(isCreditExhaustedError("billing_hard_limit_reached")).toBe(true);
  });
  it("does NOT match ordinary rate limits or other errors", () => {
    expect(isCreditExhaustedError(new Error("openai_429: rate_limit_exceeded; retry after 20s"))).toBe(false);
    expect(isCreditExhaustedError(new Error("openai_500: internal error"))).toBe(false);
    expect(isCreditExhaustedError(new Error("openai_timeout_135s"))).toBe(false);
    expect(isCreditExhaustedError(null)).toBe(false);
    expect(isCreditExhaustedError(undefined)).toBe(false);
  });
});

describe("discoveryPrimaryProvider (provider order switch)", () => {
  const prev = process.env.OUTREACH_DISCOVERY_PRIMARY;
  afterAll(() => { if (prev === undefined) delete process.env.OUTREACH_DISCOVERY_PRIMARY; else process.env.OUTREACH_DISCOVERY_PRIMARY = prev; });
  it("defaults to openai when unset/blank/unknown", () => {
    delete process.env.OUTREACH_DISCOVERY_PRIMARY;
    expect(discoveryPrimaryProvider()).toBe("openai");
    process.env.OUTREACH_DISCOVERY_PRIMARY = "";
    expect(discoveryPrimaryProvider()).toBe("openai");
    process.env.OUTREACH_DISCOVERY_PRIMARY = "openai";
    expect(discoveryPrimaryProvider()).toBe("openai");
    process.env.OUTREACH_DISCOVERY_PRIMARY = "somethingelse";
    expect(discoveryPrimaryProvider()).toBe("openai");
  });
  it("selects anthropic (case/space-insensitive) only on an explicit value", () => {
    process.env.OUTREACH_DISCOVERY_PRIMARY = "anthropic";
    expect(discoveryPrimaryProvider()).toBe("anthropic");
    process.env.OUTREACH_DISCOVERY_PRIMARY = "  ANTHROPIC ";
    expect(discoveryPrimaryProvider()).toBe("anthropic");
  });
});
