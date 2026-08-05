/**
 * The church-enrollment context cookie: how /join hands the resolved Cornerstone
 * partner to the signup flow. Set only AFTER /join validates the link token or
 * short code server-side, so the cookie is written from trusted state (not raw
 * user input). The signup page re-checks the partner is active before trusting it.
 *
 * Attribution only — Phase 1 (Option B). No pricing/discount rides on this, so the
 * cookie carries no secret and needs no signature; the worst a tampered cookie can
 * do is (harmlessly) attribute a signup to a real active church.
 */

export const CHURCH_ENROLL_COOKIE = "igy_church";
// Long enough to survive a teen reading the bulletin then signing up later, short
// enough that a shared device doesn't silently attribute a later, unrelated signup.
export const CHURCH_ENROLL_COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export interface ChurchCookie {
  partnerId: string;
  linkId: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function serializeChurchCookie(partnerId: string, linkId: string | null): string {
  return JSON.stringify({ p: partnerId, l: linkId ?? null });
}

export function readChurchCookie(raw: string | undefined | null): ChurchCookie | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as { p?: unknown; l?: unknown };
    const partnerId = typeof o.p === "string" ? o.p : "";
    if (!UUID_RE.test(partnerId)) return null;
    const linkId = typeof o.l === "string" && UUID_RE.test(o.l) ? o.l : null;
    return { partnerId, linkId };
  } catch {
    return null;
  }
}
