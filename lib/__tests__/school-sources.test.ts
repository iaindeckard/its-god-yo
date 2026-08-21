import { describe, it, expect } from "vitest";
import {
  isExcludedSchoolLead,
  applySchoolLeadPolicy,
  schoolSourcesForState,
  schoolSourceLane,
  schoolSourceLaneCount,
} from "../outreach/school-sources";
import type { DiscoveredLead } from "../outreach/leads";

const base: DiscoveredLead = {
  org_name: "St. Thomas More Catholic School",
  city: "Baton Rouge",
  state: "LA",
  contact_email: "office@stmbr.org",
  website: "https://www.stmbr.org",
  contact_source_url: "https://www.stmbr.org/contact",
  youth_source_url: "https://www.stmbr.org/admissions",
  directory_source_url: "https://en.wikipedia.org/wiki/List_of_schools_in_the_Roman_Catholic_Diocese_of_Baton_Rouge",
  source_urls: ["https://www.stmbr.org/contact"],
  discovery_confidence: "high",
};

describe("CHS New Iberia hard exclusion", () => {
  it("excludes by chspanthers.com domain (website)", () => {
    expect(isExcludedSchoolLead({ org_name: "Some School", city: "X", website: "https://www.chspanthers.com" })).toBe(true);
  });
  it("excludes by chspanthers.com bare domain and email domain", () => {
    expect(isExcludedSchoolLead({ org_name: "Some School", city: "X", website: "chspanthers.com" })).toBe(true);
    expect(isExcludedSchoolLead({ org_name: "Some School", city: "X", contact_email: "office@chspanthers.com" })).toBe(true);
  });
  it("excludes by chspanthers.com in a cited source url", () => {
    expect(isExcludedSchoolLead({ org_name: "Some School", city: "X", source_urls: ["https://chspanthers.com/contact"] })).toBe(true);
  });
  it("excludes by org name 'Catholic High' + 'New Iberia' (name or city)", () => {
    expect(isExcludedSchoolLead({ org_name: "Catholic High School", city: "New Iberia" })).toBe(true);
    expect(isExcludedSchoolLead({ org_name: "Catholic High School of New Iberia", city: "Lafayette" })).toBe(true);
  });
  it("does NOT exclude an unrelated Catholic high school", () => {
    expect(isExcludedSchoolLead({ org_name: "Catholic High School", city: "Baton Rouge" })).toBe(false);
    expect(isExcludedSchoolLead(base)).toBe(false);
  });
  it("applySchoolLeadPolicy drops any excluded lead", () => {
    const chs: DiscoveredLead = { ...base, org_name: "Catholic High School", city: "New Iberia", website: "https://chspanthers.com", contact_email: "office@chspanthers.com" };
    expect(applySchoolLeadPolicy(chs)).toBeNull();
  });
});

describe("applySchoolLeadPolicy", () => {
  it("keeps a well-sourced school, stamps entity_type=school", () => {
    const out = applySchoolLeadPolicy(base);
    expect(out).not.toBeNull();
    expect(out!.entity_type).toBe("school");
    expect(out!.discovery_method).toBe("official_directory"); // wikipedia list
    expect(out!.source_urls?.[0]).toBe(base.contact_source_url); // contact page first
  });
  it("drops a lead missing contact/evidence source urls", () => {
    expect(applySchoolLeadPolicy({ ...base, contact_source_url: undefined })).toBeNull();
    expect(applySchoolLeadPolicy({ ...base, youth_source_url: undefined })).toBeNull();
  });
  it("classifies a non-list source as secondary_web and caps high->medium", () => {
    const out = applySchoolLeadPolicy({ ...base, directory_source_url: null, discovery_confidence: "high" });
    expect(out!.discovery_method).toBe("secondary_web");
    expect(out!.discovery_confidence).toBe("medium");
    expect(out!.directory_source_url).toBeNull();
  });
});

describe("Louisiana source lanes", () => {
  it("seeds all seven LA dioceses, Wikipedia-list ones first", () => {
    const seeds = schoolSourcesForState("LA");
    expect(seeds.length).toBe(7);
    expect(seeds[0].wikipediaListUrl).toBeTruthy();
    expect(seeds.some((d) => d.diocese.includes("Lafayette"))).toBe(true); // CHS's diocese
  });
  it("lane count = dioceses + 1 fallback, and lanes cycle", () => {
    expect(schoolSourceLaneCount("LA")).toBe(8);
    expect(schoolSourceLane(0, "LA").official).toBe(true);
    expect(schoolSourceLane(7, "LA").official).toBe(false); // NCEA/other fallback
    expect(schoolSourceLane(8, "LA").label).toBe(schoolSourceLane(0, "LA").label); // wraps
  });
});
