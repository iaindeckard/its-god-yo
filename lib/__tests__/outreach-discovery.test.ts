import { describe, expect, it } from "vitest";
import { discoveryErrorStatus, discoveryIsComplete, extractDiscoveryJson } from "../outreach/discovery-core";

describe("outreach discovery core", () => {
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

  it("keeps durable results when a later provider round times out", () => {
    expect(discoveryErrorStatus(15)).toBe("completed");
    expect(discoveryErrorStatus(0)).toBe("failed");
  });
});
