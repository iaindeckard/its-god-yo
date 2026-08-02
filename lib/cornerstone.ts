import "server-only";
import crypto from "crypto";
import { getSupabaseAdmin } from "./supabaseAdmin";
import { geocodeAddress, countryCentroid } from "./geocode";
import {
  sendCornerstoneEmail,
  applicationReceivedEmail, applicationApprovedEmail, applicationDeclinedEmail,
  paymentRequiredEmail, partnerActivatedEmail, certificateAvailableEmail,
  lockedPricingChangedEmail, publicRecognitionEmail, partnerLinkEmail,
} from "./cornerstoneEmails";

/**
 * Cornerstone Partner Program data layer.
 * Spec: cornerstone_partner_program_prompt_v3.md (2026-08-01).
 *
 * Recognition (cornerstone_status) and the price lock (locked_pricing_status) are
 * deliberately separate — a church stays a Partner even if it loses the lock.
 * Partner-number assignment is NOT done here: it runs inside the DB function
 * approve_cornerstone_application() so it's transaction-safe and never-reused
 * (see migration 20260801000002). This module just calls it.
 *
 * Every table is service-role only; all access goes through the admin client.
 */

// ---- number formatting -----------------------------------------------------

/** Storage/canonical form, e.g. 1 -> "CP-000001". */
export function formatPartnerNumber(n: number): string {
  return `CP-${String(n).padStart(6, "0")}`;
}
/** Friendly display, e.g. 27 -> "Cornerstone Partner #27". */
export function displayPartnerNumber(n: number): string {
  return `Cornerstone Partner #${n}`;
}

// ---- types -----------------------------------------------------------------

export type ApplicationStatus =
  | "draft" | "submitted" | "under_review" | "approved"
  | "awaiting_payment" | "active" | "inactive" | "declined" | "cancelled";

export const APPLICATION_STATUSES: ApplicationStatus[] = [
  "draft", "submitted", "under_review", "approved",
  "awaiting_payment", "active", "inactive", "declined", "cancelled",
];

export interface Church {
  id: string;
  name: string;
  slug: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state_province: string | null;
  postal_code: string | null;
  country: string | null;
  denomination: string | null;
  estimated_attendance: number | null;
  estimated_youth_group_size: number | null;
  logo_url: string | null;
  public_recognition_opt_in: boolean;
  logo_display_opt_in: boolean;
  created_at: string;
  updated_at: string;
}

export interface CornerstoneApplication {
  id: string;
  church_id: string;
  applicant_user_id: string | null;
  contact_name: string | null;
  contact_title: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  existing_account_email: string | null;
  preferred_plan: string | null;
  status: ApplicationStatus;
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  internal_notes: string | null;   // staff-only, never church-visible
  terms_version_accepted: string | null;
  authorization_confirmed: boolean;
  source_campaign: string | null;
  created_at: string;
  updated_at: string;
}

/** An application row with its church embedded (admin review list). */
export interface ApplicationWithChurch extends CornerstoneApplication {
  church: Church | null;
}

export interface CornerstonePartner {
  id: string;
  church_id: string;
  application_id: string | null;
  partner_number: number;
  cornerstone_status: "active" | "inactive" | "revoked";
  recognition_date: string;
  activation_date: string | null;
  inactive_date: string | null;
  public_listing_status: "private" | "listed";
  original_qualifying_plan: string | null;
  original_qualifying_price_cents: number | null;
  locked_pricing_status: "none" | "active" | "suspended" | "expired";
  locked_pricing_terms: Record<string, unknown>;
  early_access_eligible: boolean;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PartnerWithChurch extends CornerstonePartner {
  church: Church | null;
}

export interface CornerstoneConfig {
  program_active: boolean;
  enrollment_opens_at: string | null;
  enrollment_closes_at: string | null;
  eligible_plans: string[];
  auto_approval_enabled: boolean;
  manual_approval_required: boolean;
  pricing_lock_rules: Record<string, unknown>;
  public_recognition_default: boolean;
  terms_version: string;
  certificate_scripture: string | null;
  updated_at: string;
  updated_by: string | null;
}

// ---- config ----------------------------------------------------------------

export async function getConfig(): Promise<CornerstoneConfig> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("cornerstone_config")
    .select("*")
    .eq("id", true)
    .single();
  if (error) throw new Error(`cornerstone_config_query_failed: ${error.message}`);
  return data as CornerstoneConfig;
}

export interface ConfigPatch {
  program_active?: boolean;
  enrollment_opens_at?: string | null;
  enrollment_closes_at?: string | null;
  eligible_plans?: string[];
  auto_approval_enabled?: boolean;
  manual_approval_required?: boolean;
  pricing_lock_rules?: Record<string, unknown>;
  public_recognition_default?: boolean;
  terms_version?: string;
  certificate_scripture?: string | null;
}

export async function updateConfig(patch: ConfigPatch, byUserId?: string | null): Promise<CornerstoneConfig> {
  const admin = getSupabaseAdmin();
  const row: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: byUserId ?? null };
  for (const k of Object.keys(patch) as (keyof ConfigPatch)[]) {
    if (patch[k] !== undefined) row[k] = patch[k];
  }
  const { data, error } = await admin
    .from("cornerstone_config")
    .update(row)
    .eq("id", true)
    .select("*")
    .single();
  if (error) throw new Error(`cornerstone_config_update_failed: ${error.message}`);
  return data as CornerstoneConfig;
}

// ---- intake (public application) ------------------------------------------

export interface ApplicationInput {
  church: {
    name: string;
    website?: string | null;
    address?: string | null;
    city?: string | null;
    state_province?: string | null;
    postal_code?: string | null;
    country?: string | null;
    denomination?: string | null;
    estimated_attendance?: number | null;
    estimated_youth_group_size?: number | null;
    public_recognition_opt_in?: boolean;
    logo_display_opt_in?: boolean;
  };
  contact_name?: string | null;
  contact_title?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  existing_account_email?: string | null;
  preferred_plan?: string | null;
  applicant_user_id?: string | null;
  terms_version_accepted?: string | null;
  authorization_confirmed: boolean;
  source_campaign?: string | null;
}

/**
 * Public intake: creates the church + a 'submitted' application in one shot.
 * Server-side validation only — never trust the client. Returns the new
 * application id. (The public form route wires this up in a later stage.)
 */
export async function submitApplication(input: ApplicationInput): Promise<{ applicationId: string; churchId: string }> {
  const admin = getSupabaseAdmin();
  if (!input.church?.name?.trim()) throw new Error("church name is required");
  if (!input.authorization_confirmed) throw new Error("authorization to act for the church must be confirmed");

  const { data: church, error: cErr } = await admin
    .from("churches")
    .insert({
      name: input.church.name.trim(),
      website: input.church.website?.trim() || null,
      address: input.church.address?.trim() || null,
      city: input.church.city?.trim() || null,
      state_province: input.church.state_province?.trim() || null,
      postal_code: input.church.postal_code?.trim() || null,
      country: input.church.country?.trim() || null,
      denomination: input.church.denomination?.trim() || null,
      estimated_attendance: input.church.estimated_attendance ?? null,
      estimated_youth_group_size: input.church.estimated_youth_group_size ?? null,
      public_recognition_opt_in: !!input.church.public_recognition_opt_in,
      logo_display_opt_in: !!input.church.logo_display_opt_in,
    })
    .select("id")
    .single();
  if (cErr) throw new Error(`church_insert_failed: ${cErr.message}`);

  const { data: app, error: aErr } = await admin
    .from("cornerstone_applications")
    .insert({
      church_id: church.id,
      applicant_user_id: input.applicant_user_id ?? null,
      contact_name: input.contact_name?.trim() || null,
      contact_title: input.contact_title?.trim() || null,
      contact_email: input.contact_email?.trim() || null,
      contact_phone: input.contact_phone?.trim() || null,
      existing_account_email: input.existing_account_email?.trim() || null,
      preferred_plan: input.preferred_plan?.trim() || null,
      status: "submitted",
      terms_version_accepted: input.terms_version_accepted?.trim() || null,
      authorization_confirmed: true,
      source_campaign: input.source_campaign?.trim() || null,
    })
    .select("id")
    .single();
  if (aErr) throw new Error(`application_insert_failed: ${aErr.message}`);

  // Geocode the church address for the partner map — best-effort, at intake, once
  // per applicant regardless of approval outcome. A failure NEVER fails the
  // submission: we log, leave lat/lng null, and the globe falls back to a
  // country-level position for that church.
  try {
    const coord = await geocodeAddress({
      address: input.church.address, city: input.church.city, state: input.church.state_province,
      postalCode: input.church.postal_code, country: input.church.country,
    });
    if (coord) {
      await admin.from("churches")
        .update({ latitude: coord.lat, longitude: coord.lng, geocoded_at: new Date().toISOString() })
        .eq("id", church.id);
    }
  } catch (e) {
    console.error(`[cornerstone] geocode failed for church ${church.id}:`, e instanceof Error ? e.message : e);
  }

  // #1 Application received — best-effort, never blocks the submission.
  await sendCornerstoneEmail(input.contact_email?.trim() || null, applicationReceivedEmail(input.church.name.trim()));

  return { applicationId: app.id, churchId: church.id };
}

// ---- admin review ----------------------------------------------------------

export async function listApplications(status?: ApplicationStatus): Promise<ApplicationWithChurch[]> {
  const admin = getSupabaseAdmin();
  let q = admin
    .from("cornerstone_applications")
    .select("*, church:churches(*)")
    .order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw new Error(`cornerstone_applications_query_failed: ${error.message}`);
  return (data ?? []) as unknown as ApplicationWithChurch[];
}

export async function getApplication(id: string): Promise<ApplicationWithChurch | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("cornerstone_applications")
    .select("*, church:churches(*)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`cornerstone_application_query_failed: ${error.message}`);
  return (data as unknown as ApplicationWithChurch) ?? null;
}

export interface ApproveResult { partnerId: string; partnerNumber: number; alreadyPartner: boolean }

/**
 * Approve an application → assign a permanent Partner number. Delegates to the
 * transaction-safe DB function; idempotent (re-approving returns the same number).
 */
export async function approveApplication(
  applicationId: string,
  reviewerUserId?: string | null,
  reason?: string | null,
): Promise<ApproveResult> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("approve_cornerstone_application", {
    p_application_id: applicationId,
    p_reviewer: reviewerUserId ?? null,
    p_reason: reason ?? null,
  });
  if (error) throw new Error(`cornerstone_approve_failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("cornerstone_approve_failed: no result");

  // #2 Application approved (recognition-first). On initial approval the partner
  // is created ACTIVE, so this doubles as the activation notice — we do NOT also
  // send #5 here. Skip entirely on idempotent re-approval (already a partner).
  if (!row.already_partner) {
    const app = await getApplication(applicationId);
    const churchName = app?.church?.name ?? "Your church";
    const statusUrl = partnerStatusUrl(row.partner_id);
    // #2 Application approved (recognition-first, carries the private status link).
    await sendCornerstoneEmail(app?.contact_email ?? null, applicationApprovedEmail(churchName, row.partner_number, statusUrl));
    // #6 Certificate available — the certificate/badge are generatable immediately
    // on approval, so this is the natural trigger. Distinct purpose from #2
    // (download the certificate + badge vs. the recognition news itself).
    await sendCornerstoneEmail(app?.contact_email ?? null, certificateAvailableEmail(churchName, row.partner_number, statusUrl));
  }

  return {
    partnerId: row.partner_id,
    partnerNumber: row.partner_number,
    alreadyPartner: !!row.already_partner,
  };
}

/** Decline an application. Records reviewer + internal reason; writes audit. */
export async function declineApplication(
  applicationId: string,
  reviewerUserId?: string | null,
  reason?: string | null,
): Promise<void> {
  const admin = getSupabaseAdmin();
  // Read the church name + contact BEFORE the update (contact is on the app, so
  // it survives, but grab it here for the email regardless).
  const app = await getApplication(applicationId);
  const { error } = await admin
    .from("cornerstone_applications")
    .update({
      status: "declined",
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewerUserId ?? null,
      internal_notes: reason?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", applicationId);
  if (error) throw new Error(`cornerstone_decline_failed: ${error.message}`);
  await logAudit({ application_id: applicationId, action: "application_declined", performed_by: reviewerUserId, reason });

  // #3 Application declined — gracious, and never exposes the internal reason.
  await sendCornerstoneEmail(app?.contact_email ?? null, applicationDeclinedEmail(app?.church?.name ?? "your church"));
}

/** Update an application's status (e.g. mark under_review) + optional internal note. */
export async function setApplicationStatus(
  applicationId: string,
  status: ApplicationStatus,
  reviewerUserId?: string | null,
  internalNote?: string | null,
): Promise<void> {
  const admin = getSupabaseAdmin();
  const row: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (reviewerUserId !== undefined) row.reviewed_by = reviewerUserId;
  if (internalNote !== undefined) row.internal_notes = internalNote?.trim() || null;
  const { error } = await admin.from("cornerstone_applications").update(row).eq("id", applicationId);
  if (error) throw new Error(`cornerstone_status_update_failed: ${error.message}`);

  // #4 Payment required — fired when an application is moved into awaiting_payment.
  // (Approval today creates an active partner directly, so this is the only path
  // that reaches a payment-pending state; it's admin-driven via this transition.)
  if (status === "awaiting_payment") {
    const app = await getApplication(applicationId);
    await sendCornerstoneEmail(app?.contact_email ?? null, paymentRequiredEmail(app?.church?.name ?? "Your church"));
  }
}

// ---- admin partner management ---------------------------------------------

export async function listPartners(): Promise<PartnerWithChurch[]> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("cornerstone_partners")
    .select("*, church:churches(*)")
    .order("partner_number", { ascending: true });
  if (error) throw new Error(`cornerstone_partners_query_failed: ${error.message}`);
  return (data ?? []) as unknown as PartnerWithChurch[];
}

export async function getPartnerByChurchId(churchId: string): Promise<PartnerWithChurch | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("cornerstone_partners")
    .select("*, church:churches(*)")
    .eq("church_id", churchId)
    .maybeSingle();
  if (error) throw new Error(`cornerstone_partner_query_failed: ${error.message}`);
  return (data as unknown as PartnerWithChurch) ?? null;
}

export interface PartnerPatch {
  cornerstone_status?: "active" | "inactive" | "revoked";
  public_listing_status?: "private" | "listed";
  locked_pricing_status?: "none" | "active" | "suspended" | "expired";
  locked_pricing_terms?: Record<string, unknown>;
  original_qualifying_plan?: string | null;
  original_qualifying_price_cents?: number | null;
  early_access_eligible?: boolean;
  activation_date?: string | null;
  inactive_date?: string | null;
}

/**
 * Manage a partner record. Never touches partner_number (the DB guard trigger
 * would reject it anyway). Writes an audit row capturing the change.
 */
export async function updatePartner(
  id: string,
  patch: PartnerPatch,
  byUserId?: string | null,
  reason?: string | null,
): Promise<CornerstonePartner> {
  const admin = getSupabaseAdmin();

  // Snapshot the fields we notify on + the recipient (church contact lives on the
  // linked application), so we can send only on a genuine change.
  const { data: before } = await admin
    .from("cornerstone_partners")
    .select("cornerstone_status, locked_pricing_status, public_listing_status, church:churches(name), application:cornerstone_applications(contact_email)")
    .eq("id", id)
    .maybeSingle();
  const b = before as unknown as {
    cornerstone_status: string; locked_pricing_status: string; public_listing_status: string;
    church: { name: string } | null; application: { contact_email: string | null } | null;
  } | null;
  const churchName = b?.church?.name ?? "Your church";
  const contact = b?.application?.contact_email ?? null;

  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of Object.keys(patch) as (keyof PartnerPatch)[]) {
    if (patch[k] !== undefined) row[k] = patch[k];
  }
  const { data, error } = await admin
    .from("cornerstone_partners")
    .update(row)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`cornerstone_partner_update_failed: ${error.message}`);
  await logAudit({ partner_id: id, action: "partner_updated", new_value: patch as Record<string, unknown>, performed_by: byUserId, reason });

  // Notifications — only when the value actually changed.
  if (b) {
    // #5 Cornerstone Partner activated — reactivation (inactive/revoked -> active).
    // NOT sent on initial approval (that's #2), so no duplication.
    if (patch.cornerstone_status === "active" && b.cornerstone_status !== "active") {
      await sendCornerstoneEmail(contact, partnerActivatedEmail(churchName, (data as CornerstonePartner).partner_number));
    }
    // #7 Locked pricing changed or removed.
    if (patch.locked_pricing_status !== undefined && patch.locked_pricing_status !== b.locked_pricing_status) {
      await sendCornerstoneEmail(contact, lockedPricingChangedEmail(churchName, patch.locked_pricing_status));
    }
    // #8 Public recognition enabled or disabled.
    if (patch.public_listing_status !== undefined && patch.public_listing_status !== b.public_listing_status) {
      await sendCornerstoneEmail(contact, publicRecognitionEmail(churchName, patch.public_listing_status === "listed"));
    }
  }

  return data as CornerstonePartner;
}

// ---- public directory (/cornerstone-partners) ------------------------------

/**
 * A single row of the PUBLIC directory. Deliberately the ONLY shape exposed
 * publicly — no contact names, emails, phones, youth-group size, billing, or
 * internal notes ever leave the server through this path.
 */
export interface PublicDirectoryEntry {
  partnerNumber: number;
  churchName: string;
  city: string | null;
  stateProvince: string | null;
  country: string | null;
  website: string | null;
  logoUrl: string | null; // only when the church authorized logo display
  yearJoined: number;
  latitude: number | null;  // church's public geocoded location (or null)
  longitude: number | null;
}

/** A single plottable globe point — SAFE fields only (identical to the flat list),
 *  plus resolved coordinates. `approx` = plotted at a country centroid because the
 *  church itself couldn't be geocoded. NEVER carries contact info, street address,
 *  youth-group size, or any private field. */
export interface GlobePoint {
  partnerNumber: number;
  churchName: string;
  city: string | null;
  stateProvince: string | null;
  country: string | null;
  yearJoined: number;
  lat: number;
  lng: number;
  approx: boolean;
}

/**
 * Build the globe points from directory entries. Uses the church's real
 * coordinates when geocoded; otherwise falls back to a country-level centroid
 * (approx=true) rather than dropping the church. An entry with neither coordinates
 * nor a known country is omitted from the globe (it still shows in the flat list).
 * Returns SAFE fields only — nothing here that isn't already in the flat list.
 */
export function toGlobePoints(entries: PublicDirectoryEntry[]): GlobePoint[] {
  const out: GlobePoint[] = [];
  for (const e of entries) {
    let lat = e.latitude, lng = e.longitude, approx = false;
    if (lat == null || lng == null) {
      const c = countryCentroid(e.country);
      if (!c) continue; // can't place it — flat list still lists it
      lat = c.lat; lng = c.lng; approx = true;
    }
    out.push({
      partnerNumber: e.partnerNumber, churchName: e.churchName, city: e.city,
      stateProvince: e.stateProvince, country: e.country, yearJoined: e.yearJoined,
      lat, lng, approx,
    });
  }
  return out;
}

export interface DirectoryFilters {
  country?: string | null;
  stateProvince?: string | null;
  year?: number | null;
}

/**
 * Churches that appear in the public directory: opted into public listing
 * (public_listing_status = 'listed') and not revoked. Selects ONLY safe columns.
 * A church with an approved designation but no public-recognition consent has
 * public_listing_status = 'private' and never appears here.
 */
export async function listPublicCornerstonePartners(): Promise<PublicDirectoryEntry[]> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("cornerstone_partners")
    .select("partner_number, recognition_date, church:churches(name, city, state_province, country, website, logo_url, logo_display_opt_in, latitude, longitude)")
    .eq("public_listing_status", "listed")
    .neq("cornerstone_status", "revoked")
    .order("partner_number", { ascending: true });
  if (error) throw new Error(`cornerstone_directory_query_failed: ${error.message}`);
  const rows = (data ?? []) as unknown as {
    partner_number: number; recognition_date: string;
    church: { name: string; city: string | null; state_province: string | null; country: string | null; website: string | null; logo_url: string | null; logo_display_opt_in: boolean; latitude: number | null; longitude: number | null } | null;
  }[];
  return rows.map((r) => ({
    partnerNumber: r.partner_number,
    churchName: r.church?.name ?? "",
    city: r.church?.city ?? null,
    stateProvince: r.church?.state_province ?? null,
    country: r.church?.country ?? null,
    website: r.church?.website ?? null,
    logoUrl: r.church?.logo_display_opt_in && r.church?.logo_url ? r.church.logo_url : null,
    yearJoined: Number(r.recognition_date.slice(0, 4)),
    latitude: r.church?.latitude ?? null,
    longitude: r.church?.longitude ?? null,
  }));
}

/** Distinct filter options derived from the listed set (pure). */
export function directoryFacets(entries: PublicDirectoryEntry[]): { countries: string[]; states: string[]; years: number[] } {
  const countries = new Set<string>(), states = new Set<string>(), years = new Set<number>();
  for (const e of entries) {
    if (e.country) countries.add(e.country);
    if (e.stateProvince) states.add(e.stateProvince);
    years.add(e.yearJoined);
  }
  return {
    countries: [...countries].sort((a, b) => a.localeCompare(b)),
    states: [...states].sort((a, b) => a.localeCompare(b)),
    years: [...years].sort((a, b) => b - a),
  };
}

/** Apply the country / state / year filters (pure). */
export function filterDirectory(entries: PublicDirectoryEntry[], f: DirectoryFilters): PublicDirectoryEntry[] {
  return entries.filter((e) =>
    (!f.country || e.country === f.country) &&
    (!f.stateProvince || e.stateProvince === f.stateProvince) &&
    (f.year == null || e.yearJoined === f.year));
}

// ---- church-facing status link (tokenized, no login) -----------------------

/**
 * Private status-page access token. IGY has no customer login, so — exactly like
 * the teen /welcome link and the outreach unsubscribe link — access is a signed,
 * unguessable token instead of a session.
 *
 * The token is an HMAC over the partner's RANDOM UUID (partner.id), NOT the
 * sequential partner_number (which is public on the directory and would be
 * predictable). It carries no timestamp, so it NEVER expires — Cornerstone
 * recognition is permanent, and a church must not get locked out of its own page.
 * Secret: CORNERSTONE_LINK_SECRET, falling back to CRON_SECRET (an existing
 * server secret). The URL is `${APP_URL}/cornerstone/status?p=<uuid>&t=<hmac>`;
 * knowing a partner number tells an attacker nothing — they have neither the UUID
 * nor the secret.
 */
const CORNERSTONE_APP_URL = (process.env.CORNERSTONE_APP_URL || process.env.OUTREACH_APP_URL || "https://itsgodyo.com").replace(/\/$/, "");

function linkSecret(): string | null {
  return process.env.CORNERSTONE_LINK_SECRET || process.env.CRON_SECRET || null;
}

export function partnerAccessToken(partnerId: string): string {
  const secret = linkSecret();
  if (!secret) return "no-secret-set"; // only in local/dev without secrets
  return crypto.createHmac("sha256", secret).update(partnerId).digest("hex").slice(0, 32);
}

export function verifyPartnerAccessToken(partnerId: string, token: string): boolean {
  const expected = partnerAccessToken(partnerId);
  if (expected === "no-secret-set") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(token || "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function partnerStatusUrl(partnerId: string): string {
  return `${CORNERSTONE_APP_URL}/cornerstone/status?p=${encodeURIComponent(partnerId)}&t=${partnerAccessToken(partnerId)}`;
}

const PLAN_LABELS: Record<string, string> = {
  group: "Group / church subscription",
  group_301plus: "Group / church subscription (301+)",
  family_annual: "Family subscription",
  gift_annual: "Gift subscription",
  individual_annual: "Individual (annual)",
  individual_monthly: "Individual (monthly)",
};

/** Church-safe view for the tokenized status page. No internal/PII fields. */
export interface PartnerStatusView {
  partnerNumber: number;
  displayNumber: string;
  churchName: string;
  cornerstoneStatus: "active" | "inactive" | "revoked";
  recognitionDate: string;
  activationDate: string | null;
  planLabel: string | null;
  includedParticipants: number | null;
  lockedPricingStatus: "none" | "active" | "suspended" | "expired";
  lockedPriceLabel: string | null;
  publicListingStatus: "private" | "listed";
}

export async function getPartnerStatusView(partnerId: string): Promise<PartnerStatusView | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("cornerstone_partners")
    .select("partner_number, cornerstone_status, recognition_date, activation_date, original_qualifying_plan, original_qualifying_price_cents, locked_pricing_status, locked_pricing_terms, public_listing_status, church:churches(name)")
    .eq("id", partnerId)
    .maybeSingle();
  if (error) throw new Error(`cornerstone_status_view_failed: ${error.message}`);
  if (!data) return null;
  const p = data as unknown as {
    partner_number: number; cornerstone_status: PartnerStatusView["cornerstoneStatus"];
    recognition_date: string; activation_date: string | null;
    original_qualifying_plan: string | null; original_qualifying_price_cents: number | null;
    locked_pricing_status: PartnerStatusView["lockedPricingStatus"];
    locked_pricing_terms: Record<string, unknown> | null;
    public_listing_status: PartnerStatusView["publicListingStatus"];
    church: { name: string } | null;
  };
  const includedRaw = p.locked_pricing_terms?.included_participants;
  const included = typeof includedRaw === "number" ? includedRaw : null;
  const lockedPriceLabel =
    p.locked_pricing_status === "active" && typeof p.original_qualifying_price_cents === "number"
      ? `$${(p.original_qualifying_price_cents / 100).toFixed(2)}`
      : null;
  return {
    partnerNumber: p.partner_number,
    displayNumber: displayPartnerNumber(p.partner_number),
    churchName: p.church?.name ?? "Your church",
    cornerstoneStatus: p.cornerstone_status,
    recognitionDate: p.recognition_date,
    activationDate: p.activation_date,
    planLabel: p.original_qualifying_plan ? (PLAN_LABELS[p.original_qualifying_plan] ?? p.original_qualifying_plan) : null,
    includedParticipants: included,
    lockedPricingStatus: p.locked_pricing_status,
    lockedPriceLabel,
    publicListingStatus: p.public_listing_status,
  };
}

/**
 * "Lost your link" recovery — staff-triggered from /admin/cornerstone. Re-emails
 * the church contact its private status link. Returns whether an email went out
 * and to whom. Idempotent to call; never throws on a send failure.
 */
export async function resendPartnerStatusLink(partnerId: string): Promise<{ sent: boolean; recipient: string | null }> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("cornerstone_partners")
    .select("partner_number, church:churches(name), application:cornerstone_applications(contact_email)")
    .eq("id", partnerId)
    .maybeSingle();
  if (error) throw new Error(`cornerstone_resend_link_failed: ${error.message}`);
  const row = data as unknown as {
    partner_number: number; church: { name: string } | null; application: { contact_email: string | null } | null;
  } | null;
  if (!row) throw new Error("partner not found");
  const to = row.application?.contact_email ?? null;
  const id = await sendCornerstoneEmail(to, partnerLinkEmail(row.church?.name ?? "Your church", row.partner_number, partnerStatusUrl(partnerId)));
  return { sent: id !== null, recipient: to };
}

// ---- audit -----------------------------------------------------------------

export interface AuditInput {
  partner_id?: string | null;
  application_id?: string | null;
  action: string;
  old_value?: Record<string, unknown> | null;
  new_value?: Record<string, unknown> | null;
  performed_by?: string | null;
  reason?: string | null;
}

export async function logAudit(input: AuditInput): Promise<void> {
  const admin = getSupabaseAdmin();
  const { error } = await admin.from("cornerstone_audit_log").insert({
    partner_id: input.partner_id ?? null,
    application_id: input.application_id ?? null,
    action: input.action,
    old_value: input.old_value ?? null,
    new_value: input.new_value ?? null,
    performed_by: input.performed_by ?? null,
    reason: input.reason?.trim() || null,
  });
  // Audit is best-effort — never let a logging failure break the primary action.
  if (error) console.error(`cornerstone_audit_failed: ${error.message}`);
}
