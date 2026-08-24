import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { OutreachLead } from "../outreach/leads";

let buildEmail: typeof import("../outreach/email").buildEmail;
let buildFollowupEmail: typeof import("../outreach/email").buildFollowupEmail;
let renderTouch: typeof import("../outreach/run").renderTouch;

beforeAll(async () => {
  ({ buildEmail, buildFollowupEmail } = await import("../outreach/email"));
  ({ renderTouch } = await import("../outreach/run"));
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

  it("carries the shared flat TOUCH2-25 offer + fixed expiry in the default follow-up", () => {
    const email = buildFollowupEmail(lead, "TOUCH2-25", 25);

    expect(email.subject).toBe("Following up for Example Church: 25% off through Oct 23");
    for (const copy of [email.text, email.html]) {
      // Safer rendering language preserved from email 1
      expect(copy).toContain("pairs each KJV verse with a plain-language slang rendering");
      expect(copy).not.toContain("rewritten into the slang");
      // Shared flat offer + eligible plans (group excluded, so NOT "any plan")
      expect(copy).toContain("TOUCH2-25");
      expect(copy).toContain("25% off an individual, family, or gift subscription");
      expect(copy).not.toContain("any plan");
      // Explicit urgency date (matches the live coupon expires_at)
      expect(copy).toContain("October 23, 2026");
      // Still the final touch
      expect(copy).toContain("last you'll hear from us");
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

  it("makes the schools follow-up a code-free distribution ask with a paste-ready blurb", () => {
    const email = buildFollowupEmail(school, "", 10, "catholic_school");
    expect(email.subject).toBe("A quick way to get IGY in front of St. Thomas More Catholic School families");
    for (const copy of [email.text, email.html]) {
      // Acknowledges no visible participation yet
      expect(copy).toContain("I haven't seen any sign-ups from St. Thomas More Catholic School families yet");
      // Existing code referenced; NO new/bigger discount
      expect(copy).toContain("APPRECIATION10");
      expect(copy).not.toContain("TOUCH2-25");
      expect(copy).not.toContain("25%");
      // Ready-to-paste newsletter/bulletin blurb
      expect(copy).toContain("A gift for our families from It's God, Yo!");
      expect(copy.toLowerCase()).toContain("newsletter");
      expect(copy.toLowerCase()).toContain("bulletin");
      // Wrong-contact escape hatch
      expect(copy).toContain("point me to the right person");
      // Compliance envelope
      expect(copy).toContain("Deckard Enterprise International, LLC");
      expect(copy.toLowerCase()).toContain("unsubscribe");
    }
  });
});

describe("renderTouch — shared-code wiring (no per-lead minting)", () => {
  it("default: code-free intro at touch 1, shared TOUCH2-25 at touch 2", () => {
    expect(renderTouch(lead, { discountPercent: 15, variant: "default" }, 1).code).toBe("");
    const t2 = renderTouch(lead, { discountPercent: 15, variant: "default" }, 2);
    // Flat shared code + fixed 25%, IGNORING the campaign's own 15% Touch-1 tier.
    expect(t2.code).toBe("TOUCH2-25");
    expect(t2.email.text).toContain("25% off an individual, family, or gift subscription");
  });

  it("schools: APPRECIATION10 carried at touch 1, code-free distribution ask at touch 2", () => {
    const school = { ...lead, org_name: "Some Catholic School" } as OutreachLead;
    expect(renderTouch(school, { discountPercent: 10, variant: "catholic_school" }, 1).code).toBe("APPRECIATION10");
    const t2 = renderTouch(school, { discountPercent: 10, variant: "catholic_school" }, 2);
    expect(t2.code).toBe(""); // no new offer
    expect(t2.email.subject).toContain("A quick way to get IGY in front of");
  });
});
