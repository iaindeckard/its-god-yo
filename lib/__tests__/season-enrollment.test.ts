import { describe, it, expect, vi, beforeAll } from "vitest";
vi.mock("server-only", () => ({}));

let seasonManageToken: (c: string) => string;
let verifySeasonManageToken: (c: string, t: string) => boolean;

beforeAll(async () => {
  process.env.SEASON_LINK_SECRET = "test-secret-abc";
  const mod = await import("../seasons/token");
  seasonManageToken = mod.seasonManageToken;
  verifySeasonManageToken = mod.verifySeasonManageToken;
});

describe("season manage token — HMAC round-trip, no-login access", () => {
  it("verifies a genuine token for the right customer", () => {
    const t = seasonManageToken("cus_ABC");
    expect(t).toHaveLength(32);
    expect(verifySeasonManageToken("cus_ABC", t)).toBe(true);
  });
  it("rejects a token issued for a different customer", () => {
    const t = seasonManageToken("cus_ABC");
    expect(verifySeasonManageToken("cus_OTHER", t)).toBe(false);
  });
  it("rejects a tampered / empty token", () => {
    expect(verifySeasonManageToken("cus_ABC", "deadbeef")).toBe(false);
    expect(verifySeasonManageToken("cus_ABC", "")).toBe(false);
  });
});
