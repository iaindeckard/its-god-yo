import { describe, it, expect } from "vitest";
import { SEASONS_ENABLED } from "../flags";
import { setSeasonEnrollment } from "../seasons/enrollment";

// Guards the fail-closed gate on the season ENROLLMENT path (not just the crons).
// These run with the shipped flag value, which must stay false until go-live.
describe("seasons enrollment gate (fail-closed while dark)", () => {
  it("ships with SEASONS_ENABLED=false (prep PR must not flip it live)", () => {
    expect(SEASONS_ENABLED).toBe(false);
  });

  it("setSeasonEnrollment throws before touching the DB while seasons are dark", async () => {
    // Pass a poison db: if the guard did NOT fire first, this would throw a
    // different error (reading .from of null), so the assertion also proves the
    // flag check runs BEFORE any DB access.
    const poisonDb = null as unknown as Parameters<typeof setSeasonEnrollment>[0];
    await expect(
      setSeasonEnrollment(poisonDb, { customerId: "cus_test", seasonKey: "advent", active: true }),
    ).rejects.toThrow(/seasons_disabled/);
  });
});
