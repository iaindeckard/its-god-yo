// `lib/twilio.ts` pulls in `server-only`, which throws when imported outside a
// React Server Component. Stub it so we can unit-test classifyReply here.
import { vi, describe, it, expect } from "vitest";
vi.mock("server-only", () => ({}));

import { toE164, toE164FromParts, phoneKey } from "../phone";
import { classifyReply } from "../twilio";
import { countryByIso2, searchCountries, flagEmoji } from "../countries";

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

describe("toE164FromParts (country picker: dial code + national number)", () => {
  it("US +1 national -> +1E.164", () => {
    expect(toE164FromParts("1", "3163048915")).toBe("+13163048915");
  });
  it("strips human formatting from the national part", () => {
    expect(toE164FromParts("1", "(316) 304-8915")).toBe("+13163048915");
  });
  it("MX +52 national -> +52 (not +1)", () => {
    expect(toE164FromParts("52", "5512345678")).toBe("+525512345678");
  });
  it("drops a domestic trunk leading zero (UK etc.)", () => {
    expect(toE164FromParts("44", "07911123456")).toBe("+447911123456");
  });
  it("respects a full +international number the user pasted, ignoring the picker", () => {
    expect(toE164FromParts("52", "+13163048915")).toBe("+13163048915");
  });
  it("empty national -> empty (so the submit button stays disabled)", () => {
    expect(toE164FromParts("1", "")).toBe("");
    expect(toE164FromParts("1", "   ")).toBe("");
  });
});

describe("countries catalog", () => {
  it("resolves ISO2 to the right dial code and falls back to US", () => {
    expect(countryByIso2("MX").dial).toBe("52");
    expect(countryByIso2("GB").dial).toBe("44");
    expect(countryByIso2("ZZ").iso2).toBe("US"); // unknown -> default
    expect(countryByIso2(null).iso2).toBe("US");
  });
  it("search is diacritic-insensitive and matches name, dial, and iso2", () => {
    expect(searchCountries("mexico").some((c) => c.iso2 === "MX")).toBe(true);
    expect(searchCountries("cote").some((c) => c.iso2 === "CI")).toBe(true); // Côte d'Ivoire
    expect(searchCountries("+44").some((c) => c.iso2 === "GB")).toBe(true);
    expect(searchCountries("mx").some((c) => c.iso2 === "MX")).toBe(true);
  });
  it("emits a regional-indicator flag emoji", () => {
    expect(flagEmoji("US")).toBe("🇺🇸");
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
