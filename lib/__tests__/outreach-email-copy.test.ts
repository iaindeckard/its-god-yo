import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { OutreachLead } from "../outreach/leads";

let buildEmail: typeof import("../outreach/email").buildEmail;
let buildFollowupEmail: typeof import("../outreach/email").buildFollowupEmail;

beforeAll(async () => {
  ({ buildEmail, buildFollowupEmail } = await import("../outreach/email"));
});

const lead = {
  id: "11111111-1111-4111-8111-111111111111",
  org_name: "Example Church",
  contact_email: "office@example.org",
  campaign_id: "22222222-2222-4222-8222-222222222222",
  city: "Wichita",
  state: "KS",
  source_urls: ["https://example.org/youth"],
} as OutreachLead;

describe("outreach email copy", () => {
  it("describes a separate rendering without absolute freshness claims", () => {
    const email = buildEmail(lead);

    for (const copy of [email.text, email.html]) {
      expect(copy).toContain("plain-language slang rendering designed to help teens understand it");
      expect(copy).toContain("protecting the verse's meaning");
      expect(copy).not.toContain("rewritten in their language");
      expect(copy).not.toContain("never stale");
    }
  });

  it("keeps the safer rendering language in the follow-up", () => {
    const email = buildFollowupEmail(lead, "IGY-EXAMPLE", 10);

    for (const copy of [email.text, email.html]) {
      expect(copy).toContain("pairs each KJV verse with a plain-language slang rendering");
      expect(copy).not.toContain("rewritten into the slang");
    }
  });

  const school = {
    id: "33333333-3333-4333-8333-333333333333",
    org_name: "St. Thomas More Catholic School",
    contact_email: "office@stmbr.org",
    campaign_id: "44444444-4444-4444-8444-444444444444",
    city: "Baton Rouge",
    state: "LA",
    source_urls: ["https://stmbr.org/contact"],
  } as OutreachLead;

  it("routes the catholic_school variant to the schools copy (verbatim + attestation + code)", () => {
    const email = buildEmail(school, "catholic_school", 10);
    expect(email.subject).toBe("A note for St. Thomas More Catholic School families");
    for (const copy of [email.text, email.html]) {
      // Role greeting (not "Dear [Principal Name]")
      expect(copy).toContain("St. Thomas More Catholic School Administration");
      // Verbatim spec framing
      expect(copy).toContain("I attended Catholic High in New Iberia, Louisiana for several years");
      expect(copy).toContain("10% off");
      expect(copy).toContain("individual annual, family, or gift subscription");
      expect(copy).toContain("APPRECIATION10");
      expect(copy).toContain("valid through December 31, 2026");
      // Authorized attestation-mention addition
      expect(copy.toLowerCase()).toContain("attestation");
      // DM from Him upsell, pitched separately (not a code condition)
      expect(copy).toContain("DM from Him");
      // Compliance envelope
      expect(copy).toContain("Deckard Enterprise International, LLC");
      expect(copy.toLowerCase()).toContain("unsubscribe");
      // Never a church/youth-ministry framing for a school
      expect(copy).not.toContain("youth ministry");
    }
  });
});
