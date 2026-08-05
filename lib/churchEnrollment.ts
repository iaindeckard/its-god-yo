import "server-only";
import crypto from "crypto";
import { getSupabaseAdmin } from "./supabaseAdmin";

/**
 * Church group enrollment — Phase 1 data layer (Option B: individual billing,
 * church-attributed). A Cornerstone Partner church gets a shareable enrollment
 * link + short code; teens self-enroll through the normal signup flow and the
 * resulting subscription is attributed to the church. Nothing here bills anyone
 * or collects a phone number — attribution + a progress counter only.
 *
 * Every table is service-role only; all access goes through the admin client.
 */

const APP_URL = (
  process.env.CORNERSTONE_APP_URL || process.env.OUTREACH_APP_URL || "https://itsgodyo.com"
).replace(/\/$/, "");

function linkSecret(): string | null {
  return process.env.CORNERSTONE_LINK_SECRET || process.env.CRON_SECRET || null;
}

/**
 * Enrollment-link access token — an HMAC over the partner UUID, namespaced
 * "enroll:" so it is DISTINCT from lib/cornerstone.partnerAccessToken (which
 * grants the church's PRIVATE status/certificate page). The enrollment link is
 * broadcast to hundreds of teens; it must never double as the private status
 * link. Non-expiring and unguessable, same as the status token.
 */
export function enrollmentToken(partnerId: string): string {
  const secret = linkSecret();
  if (!secret) return "no-secret-set"; // local/dev without secrets
  return crypto.createHmac("sha256", secret).update(`enroll:${partnerId}`).digest("hex").slice(0, 32);
}

export function verifyEnrollmentToken(partnerId: string, token: string): boolean {
  const expected = enrollmentToken(partnerId);
  if (expected === "no-secret-set") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(token || "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** The full shareable link for a partner (unguessable token, no DB lookup needed). */
export function enrollmentUrl(partnerId: string): string {
  return `${APP_URL}/join?c=${encodeURIComponent(partnerId)}&t=${enrollmentToken(partnerId)}`;
}

/** The short-code form of the link (human handle read aloud / printed). */
export function shortCodeUrl(shortCode: string): string {
  return `${APP_URL}/join?code=${encodeURIComponent(shortCode)}`;
}

// ---- short code -------------------------------------------------------------

// Crockford-ish alphabet: no 0/O/1/I/L to avoid read-aloud/transcription errors.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function genShortCode(): string {
  const bytes = crypto.randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out; // stored without a separator; formatShortCode adds one for display
}

/** Display form, e.g. "ABCD2345" -> "ABCD-2345". */
export function formatShortCode(code: string): string {
  const c = code.toUpperCase();
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

/** Normalize user-typed input back to the stored form (strip separators/space). */
export function normalizeShortCode(input: string): string {
  return (input || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

// ---- types ------------------------------------------------------------------

export interface EnrollmentLink {
  id: string;
  partnerId: string;
  shortCode: string;        // stored form (no separator)
  status: "active" | "paused" | "revoked";
  url: string;              // full token link
  codeUrl: string;          // short-code link
  displayCode: string;      // "ABCD-2345"
}

export interface EnrollmentProgress {
  totalStarted: number;
  awaitingConfirmation: number;
  joined: number;
  active: number;
  lapsed: number;
  lastSignupAt: string | null;
}

function toLink(row: {
  id: string; cornerstone_partner_id: string; short_code: string; status: EnrollmentLink["status"];
}): EnrollmentLink {
  return {
    id: row.id,
    partnerId: row.cornerstone_partner_id,
    shortCode: row.short_code,
    status: row.status,
    url: enrollmentUrl(row.cornerstone_partner_id),
    codeUrl: shortCodeUrl(row.short_code),
    displayCode: formatShortCode(row.short_code),
  };
}

// ---- reads ------------------------------------------------------------------

/** The one live (active|paused) link for a partner, or null. */
export async function getEnrollmentLink(partnerId: string): Promise<EnrollmentLink | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("church_enrollment_links")
    .select("id, cornerstone_partner_id, short_code, status")
    .eq("cornerstone_partner_id", partnerId)
    .neq("status", "revoked")
    .maybeSingle();
  if (error) throw new Error(`enrollment_link_read_failed: ${error.message}`);
  return data ? toLink(data) : null;
}

/** Resolve a typed/scanned short code to its partner + link, if active. */
export async function resolvePartnerByShortCode(
  input: string,
): Promise<{ partnerId: string; linkId: string } | null> {
  const code = normalizeShortCode(input);
  if (!code) return null;
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("church_enrollment_links")
    .select("id, cornerstone_partner_id, status")
    .eq("short_code", code)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error(`enrollment_code_resolve_failed: ${error.message}`);
  return data ? { partnerId: data.cornerstone_partner_id, linkId: data.id } : null;
}

/** Confirm a partner exists and its Cornerstone recognition is active. */
export async function isActivePartner(partnerId: string): Promise<boolean> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("cornerstone_partners")
    .select("id, cornerstone_status")
    .eq("id", partnerId)
    .maybeSingle();
  if (error) throw new Error(`partner_lookup_failed: ${error.message}`);
  return !!data && data.cornerstone_status === "active";
}

/** Church name for the "You're joining through {church}" banner. */
export async function churchNameForPartner(partnerId: string): Promise<string | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("cornerstone_partners")
    .select("church:churches(name)")
    .eq("id", partnerId)
    .maybeSingle();
  if (error) throw new Error(`church_name_lookup_failed: ${error.message}`);
  const row = data as unknown as { church: { name: string } | null } | null;
  return row?.church?.name ?? null;
}

/** Per-partner enrollment progress for the church dashboard (zeros if none yet). */
export async function getEnrollmentProgress(partnerId: string): Promise<EnrollmentProgress> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("v_church_enrollment_progress")
    .select("total_started, awaiting_confirmation, joined, active, lapsed, last_signup_at")
    .eq("cornerstone_partner_id", partnerId)
    .maybeSingle();
  if (error) throw new Error(`enrollment_progress_failed: ${error.message}`);
  return {
    totalStarted: data?.total_started ?? 0,
    awaitingConfirmation: data?.awaiting_confirmation ?? 0,
    joined: data?.joined ?? 0,
    active: data?.active ?? 0,
    lapsed: data?.lapsed ?? 0,
    lastSignupAt: data?.last_signup_at ?? null,
  };
}

// ---- writes (staff) ---------------------------------------------------------

/** Get the partner's live link, creating an active one (unique short code) if none. */
export async function getOrCreateEnrollmentLink(
  partnerId: string,
  createdBy?: string | null,
): Promise<EnrollmentLink> {
  const existing = await getEnrollmentLink(partnerId);
  if (existing) return existing;
  const admin = getSupabaseAdmin();
  // Retry a few times on the (astronomically unlikely) short_code collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = genShortCode();
    const { data, error } = await admin
      .from("church_enrollment_links")
      .insert({ cornerstone_partner_id: partnerId, short_code: code, created_by: createdBy ?? null })
      .select("id, cornerstone_partner_id, short_code, status")
      .single();
    if (!error && data) return toLink(data);
    // 23505 = unique_violation. If it's the partner-live index, another request
    // just created the link — return that. If it's the code, retry with a new one.
    if (error?.code === "23505") {
      const raced = await getEnrollmentLink(partnerId);
      if (raced) return raced;
      continue;
    }
    throw new Error(`enrollment_link_create_failed: ${error?.message ?? "unknown"}`);
  }
  throw new Error("enrollment_link_create_failed: could not allocate a unique short code");
}

async function setLinkStatus(linkId: string, status: EnrollmentLink["status"]): Promise<void> {
  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from("church_enrollment_links")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", linkId);
  if (error) throw new Error(`enrollment_link_status_update_failed: ${error.message}`);
}

export const pauseEnrollmentLink = (linkId: string) => setLinkStatus(linkId, "paused");
export const reactivateEnrollmentLink = (linkId: string) => setLinkStatus(linkId, "active");

/** Rotate: revoke the current live link and mint a fresh one (old code stops working). */
export async function rotateEnrollmentLink(
  partnerId: string,
  createdBy?: string | null,
): Promise<EnrollmentLink> {
  const current = await getEnrollmentLink(partnerId);
  if (current) await setLinkStatus(current.id, "revoked");
  return getOrCreateEnrollmentLink(partnerId, createdBy);
}
