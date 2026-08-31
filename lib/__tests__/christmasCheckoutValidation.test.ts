import { describe, it, expect, vi } from "vitest";

// If the birth-year validation did NOT reject first, the handler would call these and
// throw. So a clean 400 proves the API fails closed BEFORE touching DB or Stripe.
vi.mock("@/lib/supabaseAdmin", () => ({ getSupabaseAdmin: () => { throw new Error("REACHED_ADMIN"); } }));
vi.mock("@/lib/stripe", () => ({ getStripe: () => { throw new Error("REACHED_STRIPE"); } }));

import { POST } from "@/app/api/christmas-gift/checkout/route";

const req = (body: unknown) => ({ json: async () => body } as unknown as Request);
async function call(body: unknown) {
  const res = await POST(req(body));
  return { status: res.status, body: (await res.json()) as { ok: boolean; error?: string } };
}
// Valid email/phone/language/release so validation advances to the birth-year check.
const base = { purchaser_email: "b@x.com", recipient_phone: "+13165551234", language: "en", release_at: "2026-12-24" };

describe("christmas checkout: server-side birth-year validation (fail-closed)", () => {
  it("rejects a MISSING birth year with 400, before reaching DB/Stripe", async () => {
    const r = await call({ ...base });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ ok: false, error: "recipient_birth_year_required" });
  });

  it("rejects a non-numeric (string) birth year", async () => {
    const r = await call({ ...base, recipient_birth_year: "1990" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("recipient_birth_year_required");
  });

  it("rejects a non-integer birth year", async () => {
    const r = await call({ ...base, recipient_birth_year: 1990.5 });
    expect(r.body.error).toBe("recipient_birth_year_required");
  });

  it("rejects an out-of-range birth year (too old)", async () => {
    const r = await call({ ...base, recipient_birth_year: 1850 });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("recipient_birth_year_invalid");
  });

  it("rejects a future birth year", async () => {
    const r = await call({ ...base, recipient_birth_year: new Date().getFullYear() + 1 });
    expect(r.body.error).toBe("recipient_birth_year_invalid");
  });
});
