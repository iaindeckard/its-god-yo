// `lib/twilio.ts` pulls in `server-only`, which throws when imported outside a
// React Server Component. Stub it so we can unit-test classifyReply here.
import { vi, describe, it, expect } from "vitest";
vi.mock("server-only", () => ({}));

import { toE164, phoneKey } from "../phone";
import { classifyReply } from "../twilio";

describe("toE164 (canonical E.164 for storage/sending)", () => {
  it("US 10-digit -> +1", () => {
    expect(toE164("5551234567")).toBe("+15551234567");
  });

  it("formatted US number (parens/spaces/dashes) -> +1", () => {
    expect(toE164("(555) 123-4567")).toBe("+15551234567");
  });

  it("is idempotent on an E.164 input", () => {
    expect(toE164("+15551234567")).toBe("+15551234567");
    expect(toE164(toE164("5551234567"))).toBe("+15551234567");
  });

  it("11 digits with leading 1 -> +<digits>", () => {
    expect(toE164("15551234567")).toBe("+15551234567");
  });

  it("bare 10-digit MX with country 'MX' -> +52 (NOT +1) — the mis-normalization fix", () => {
    expect(toE164("5512345678", "MX")).toBe("+525512345678");
    expect(toE164("5512345678", "MX")).not.toContain("+1");
  });

  it("already-E.164 MX number is preserved regardless of country hint", () => {
    expect(toE164("+52 55 1234 5678")).toBe("+525512345678");
  });

  it("empty/blank stays empty", () => {
    expect(toE164("")).toBe("");
    expect(toE164("   ")).toBe("");
    expect(toE164(null)).toBe("");
  });
});

describe("phoneKey (tolerant matching key)", () => {
  it("is equal across national, E.164, and Twilio-From variants of the same US number", () => {
    const national = phoneKey("5551234567");
    const e164 = phoneKey("+15551234567");
    const from = phoneKey("+1 (555) 123-4567"); // Twilio delivers E.164, but be liberal
    expect(national).toBe(e164);
    expect(e164).toBe(from);
    expect(national).toBe("5551234567");
  });

  it("drops the country-code prefix so +1 vs +52 collide only on the last 10", () => {
    // Same 10 national digits under different country codes share a key (by design:
    // the key is a tolerant matcher, canonical storage disambiguates the real number).
    expect(phoneKey("+525512345678")).toBe(phoneKey("5512345678"));
    expect(phoneKey("+525512345678")).toBe("5512345678");
  });

  it("matches a stored E.164 against the inbound Twilio From for the same number", () => {
    const stored = toE164("5512345678", "MX"); // +525512345678
    const inboundFrom = "+525512345678";
    expect(phoneKey(stored)).toBe(phoneKey(inboundFrom));
  });
});

describe("classifyReply", () => {
  it("classifies STOP-family keywords as stop (incl. NO)", () => {
    for (const w of ["STOP", "stop", "Stop.", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "NO"]) {
      expect(classifyReply(w)).toBe("stop");
    }
  });

  it("classifies YES-family keywords as confirm (incl. Spanish SÍ)", () => {
    for (const w of ["YES", "y", "yeah", "SI", "SÍ", "sí", "START"]) {
      expect(classifyReply(w)).toBe("confirm");
    }
  });

  it("classifies HELP keywords as help (incl. Spanish AYUDA)", () => {
    for (const w of ["HELP", "info", "AYUDA"]) {
      expect(classifyReply(w)).toBe("help");
    }
  });

  it("classifies anything else as unknown", () => {
    expect(classifyReply("what is this")).toBe("unknown");
    expect(classifyReply("")).toBe("unknown");
  });
});
