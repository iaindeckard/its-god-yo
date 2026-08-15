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
});
