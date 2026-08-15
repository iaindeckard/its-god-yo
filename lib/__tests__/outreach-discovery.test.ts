import { describe, expect, it } from "vitest";
import {
  discoveryErrorStatus,
  discoveryIsComplete,
  extractDiscoveryJson,
  providerResponsePhase,
} from "../outreach/discovery-core";
import {
  OFFICIAL_CHURCH_DIRECTORIES,
  applyDirectorySourcePolicy,
  officialDirectoryForUrl,
} from "../outreach/directory-sources";

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

  it("classifies background provider response states", () => {
    expect(providerResponsePhase("queued")).toBe("pending");
    expect(providerResponsePhase("in_progress")).toBe("pending");
    expect(providerResponsePhase("completed")).toBe("completed");
    expect(providerResponsePhase("failed")).toBe("failed");
    expect(providerResponsePhase("cancelled")).toBe("failed");
  });

  it("recognizes official national directory subdomains", () => {
    expect(OFFICIAL_CHURCH_DIRECTORIES.length).toBeGreaterThanOrEqual(7);
    expect(officialDirectoryForUrl("https://churches.sbc.net/church/123")?.id).toBe("sbc");
    expect(officialDirectoryForUrl("https://example.com/churches")).toBeNull();
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
