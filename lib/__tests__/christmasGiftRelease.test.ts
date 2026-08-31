import { describe, it, expect, vi } from "vitest";

// Mock the age gate: born >= 2015 is too young -> block; otherwise standard.
vi.mock("../ageGate", () => ({
  FAILSAFE_MIN_AGE: 16,
  parseCountryFromPhone: () => "US",
  evaluateAgeGate: async (_phone: string, birthYear: number) => ({
    decision: birthYear >= 2015 ? "block" : "standard",
    country: "US",
    age: 2026 - birthYear,
    minAge: 16,
    confirmed: true,
    mechanism: null,
  }),
}));

import { runChristmasGiftRelease } from "../christmasGiftRelease";

// Minimal Supabase mock: records filter state; a terminal await resolves to the right
// row set based on which pass's query it is (routed by the status filter + the
// confirmation_resent_at IS NULL marker that only pass 2 sets).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockAdmin(sets: { due: any[]; resend: any[]; credit: any[] }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const make = (state: any): any => ({
    from: (t: string) => make({ ...state, table: t }),
    select: () => make(state),
    eq: (col: string, val: string) => make({ ...state, [`eq_${col}`]: val }),
    is: (col: string) => make({ ...state, [`is_${col}`]: true }),
    lte: () => make(state),
    update: () => make({ ...state, isUpdate: true }),
    delete: () => make({ ...state, isDelete: true }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then: (resolve: (v: any) => void) => resolve(resolveData(state)),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function resolveData(state: any) {
    if (state.table === "pending_signups") return { data: [], error: null };
    if (state.eq_status === "awaiting_release") return { data: sets.due, error: null };
    if (state.eq_status === "confirmation_sent" && state.is_confirmation_resent_at) return { data: sets.resend, error: null };
    if (state.eq_status === "confirmation_sent") return { data: sets.credit, error: null };
    return { data: [], error: null };
  }
  return make({});
}

const dueRow = (id: string, birthYear: number, phone: string) => ({
  id, recipient_phone: phone, recipient_birth_year: birthYear, recipient_country_code: "US",
  language: "en", charged_amount_cents: 5900, recipient_first_name: "R", purchaser_email: "p@x.com",
  purchaser_first_name: "P", stripe_customer_id: "cus", gifter_first_name: null, gifter_honorific: null,
  gifter_relationship: null, consent_log_id: null,
});

describe("runChristmasGiftRelease (dry run) branching", () => {
  it("splits due rows into released vs age-gate-credited, and counts resend + credit passes", async () => {
    const due = [dueRow("p1", 2000, "+13165550001"), dueRow("p2", 2020, "+13165550002")];
    const admin = mockAdmin({ due, resend: [{ id: "p3" }], credit: [{ id: "p4" }] });
    const s = await runChristmasGiftRelease({ admin, nowMs: Date.parse("2026-12-05T18:00:00Z"), dryRun: true });
    expect(s.released).toBe(1); // p1 born 2000 -> standard
    expect(s.age_gate_credited).toBe(1); // p2 born 2020 -> block
    expect(s.resent).toBe(1);
    expect(s.credited).toBe(1);
    expect(s.deactivated).toBe(0); // pass 4 skipped in dry run
    expect(s.errors).toEqual([]);
    expect(s.dry_run).toBe(true);
  });

  it("no due rows -> all zero", async () => {
    const admin = mockAdmin({ due: [], resend: [], credit: [] });
    const s = await runChristmasGiftRelease({ admin, nowMs: Date.parse("2026-12-05T18:00:00Z"), dryRun: true });
    expect(s).toMatchObject({ released: 0, age_gate_credited: 0, resent: 0, credited: 0, deactivated: 0, errors: [] });
  });
});
