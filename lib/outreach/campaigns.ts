import "server-only";
import { getSupabaseAdmin } from "../supabaseAdmin";
import { geocodeAddress, type LatLng } from "../geocode";

/**
 * Geographic-scoped outreach campaigns (Phase 1 of the approved architecture).
 * A campaign is a named, persistent search region — a center point + radius the
 * discovery agent searches within — whose leads are size-segmented and gated
 * behind a staged->active promote action before any send. ROI is attributed by
 * campaign_id/size_bucket on the leads (Option A: one lead, one campaign).
 *
 * Service-role only, like leads.ts and the other back-office modules.
 */

export type SizeBucket = "small" | "medium" | "large" | "mega" | "unknown";
export type CampaignStatus = "draft" | "discovering" | "ready" | "scheduled" | "sending" | "active" | "completed" | "paused" | "archived";

export interface Campaign {
  id: string;
  name: string;
  center_label: string;
  center_lat: number | null;
  center_lng: number | null;
  radius_miles: number;
  geography_type: "radius" | "state";
  state_code: string | null;
  size_filter: string[] | null;
  denomination_filter: string[] | null;
  discovery_target_count: number | null;
  discount_percent: number;
  message_variant: string | null;
  investment_cents: number;
  allocated_budget_cents: number;
  reinvested_net_revenue_cents: number;
  reinvestment_source_campaign_id: string | null;
  reinvestment_proposal_id: string | null;
  status: CampaignStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  release_at: string | null;
  release_timezone: string | null;
  scheduled_at: string | null;
  scheduled_by: string | null;
  schedule_snapshot: Record<string, unknown> | null;
  release_started_at: string | null;
  release_completed_at: string | null;
  last_release_report: Record<string, unknown> | null;
}

const TABLE = "outreach_campaigns";

/**
 * Attendance -> size bucket. Only "mega" has an industry standard (Hartford
 * Institute: 2,000+ weekly attendance); the rest are reasonable market bands.
 * A null/unknown attendance is "unknown" — never guessed (spec §size).
 */
export function sizeBucket(attendance: number | null | undefined): SizeBucket {
  if (attendance == null || !Number.isFinite(attendance) || attendance <= 0) return "unknown";
  if (attendance < 100) return "small";
  if (attendance < 500) return "medium";
  if (attendance < 2000) return "large";
  return "mega";
}

const EARTH_RADIUS_MILES = 3958.7613;

/** Great-circle distance in miles between two coordinates. */
export function haversineMiles(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface CreateCampaignInput {
  name: string;
  centerLabel: string;
  radiusMiles: number;
  geographyType?: "radius" | "state";
  stateCode?: string | null;
  sizeFilter?: string[] | null;
  denominationFilter?: string[] | null;
  discoveryTargetCount?: number | null;
  createdBy?: string | null;
  // When the map picker already resolved coordinates, pass them to skip the
  // server-side geocode. Omit (Phase 1 / text-only create) to geocode centerLabel.
  centerLat?: number | null;
  centerLng?: number | null;
}

/**
 * Create a campaign. When explicit center coordinates are supplied (the Phase 2
 * map picker), they are used directly. Otherwise the center label is geocoded
 * best-effort — a miss leaves center_lat/lng null and never blocks creation.
 */
export async function createCampaign(input: CreateCampaignInput): Promise<Campaign> {
  const admin = getSupabaseAdmin();
  const hasCoords = input.centerLat != null && input.centerLng != null;
  const center = input.geographyType === "state"
    ? null
    : hasCoords
    ? { lat: input.centerLat as number, lng: input.centerLng as number }
    : await geocodeAddress({ address: input.centerLabel, country: "United States" });
  const row = {
    name: input.name.trim(),
    center_label: input.centerLabel.trim(),
    center_lat: center?.lat ?? null,
    center_lng: center?.lng ?? null,
    radius_miles: input.radiusMiles,
    geography_type: input.geographyType ?? "radius",
    state_code: input.geographyType === "state" ? input.stateCode?.toUpperCase() ?? null : null,
    size_filter: input.sizeFilter ?? null,
    denomination_filter: input.denominationFilter?.length ? input.denominationFilter : null,
    discovery_target_count: input.discoveryTargetCount ?? null,
    created_by: input.createdBy ?? null,
  };
  const { data, error } = await admin.from(TABLE).insert(row).select("*").single();
  if (error) throw new Error(`create_campaign_failed: ${error.message}`);
  return data as Campaign;
}

export async function listCampaigns(): Promise<Campaign[]> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from(TABLE).select("*").order("created_at", { ascending: false });
  if (error) throw new Error(`list_campaigns_failed: ${error.message}`);
  return (data ?? []) as Campaign[];
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  const admin = getSupabaseAdmin();
  const { data } = await admin.from(TABLE).select("*").eq("id", id).maybeSingle();
  return (data as Campaign) ?? null;
}

export interface CampaignPatch {
  name?: string;
  status?: CampaignStatus;
  size_filter?: string[] | null;
  denomination_filter?: string[] | null;
  discovery_target_count?: number | null;
  radius_miles?: number;
  geography_type?: "radius" | "state";
  state_code?: string | null;
  center_label?: string;
  center_lat?: number | null;
  center_lng?: number | null;
  discount_percent?: number;
  message_variant?: string | null;
  investment_cents?: number;
  release_at?: string | null;
  release_timezone?: string | null;
  scheduled_at?: string | null;
  scheduled_by?: string | null;
  schedule_snapshot?: Record<string, unknown> | null;
  release_started_at?: string | null;
  release_completed_at?: string | null;
  last_release_report?: Record<string, unknown> | null;
}

export async function updateCampaign(id: string, patch: CampaignPatch): Promise<Campaign> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from(TABLE)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`update_campaign_failed: ${error.message}`);
  return data as Campaign;
}

/** Roll back a just-created draft when a proposal approval loses a race or fails. */
export async function deleteDraftCampaign(id: string): Promise<void> {
  const { error } = await getSupabaseAdmin().from(TABLE).delete().eq("id", id).eq("status", "draft");
  if (error) throw new Error(`delete_draft_campaign_failed: ${error.message}`);
}
