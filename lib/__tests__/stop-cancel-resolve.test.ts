import { describe, expect, it } from "vitest";
import { resolveActiveSignupForConsent } from "../stopCancelResolve";

/**
 * Minimal mock of the Supabase query builder. Records the filter state as the chain
 * is built; `maybeSingle()` asks the provided `resolve(state)` for the row (or null).
 * Supports the exact chains resolveActiveSignupForConsent uses:
 *   .from().select().eq().in().maybeSingle()            (back-reference lookup)
 *   .from().select().or().in().limit().maybeSingle()    (forward-link lookup)
 */
interface QueryState { table?: string; eqId?: string; or?: string }
function mockAdmin(resolve: (s: QueryState) => unknown) {
  const build = (s: QueryState): Record<string, unknown> => ({
    from: (table: string) => build({ ...s, table }),
    select: () => build(s),
    eq: (col: string, val: string) => build(col === "id" ? { ...s, eqId: val } : s),
    or: (expr: string) => build({ ...s, or: expr }),
    in: () => build(s),
    limit: () => build(s),
    maybeSingle: async () => ({ data: resolve(s) }),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return build({}) as any;
}

describe("resolveActiveSignupForConsent", () => {
  it("resolves via the back-reference when it points to an active signup", async () => {
    const admin = mockAdmin((s) => (s.eqId === "sig-A" ? { id: "sig-A" } : null));
    expect(await resolveActiveSignupForConsent(admin, "consent-1", "sig-A")).toEqual({ id: "sig-A" });
  });

  // The bug this fix closes: a confirmed subscriber whose consent_log.pending_signup_id
  // is null must STILL resolve (via the forward link) so their STOP cancels billing.
  it("falls back to the forward link when the back-reference is null", async () => {
    const admin = mockAdmin((s) => (s.or?.includes("consent-1") ? { id: "sig-B" } : null));
    expect(await resolveActiveSignupForConsent(admin, "consent-1", null)).toEqual({ id: "sig-B" });
  });

  it("falls back to the forward link when the back-reference is stale/inactive", async () => {
    // Back-ref lookup returns null (signup not active); forward link finds the live one.
    const admin = mockAdmin((s) => (s.or?.includes("consent-1") ? { id: "sig-C" } : null));
    expect(await resolveActiveSignupForConsent(admin, "consent-1", "sig-stale")).toEqual({ id: "sig-C" });
  });

  it("returns null when neither link resolves an active signup", async () => {
    const admin = mockAdmin(() => null);
    expect(await resolveActiveSignupForConsent(admin, "consent-1", "sig-A")).toBeNull();
  });
});
