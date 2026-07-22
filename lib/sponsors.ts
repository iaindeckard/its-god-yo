import "server-only";
import { getSupabaseAdmin } from "./supabaseAdmin";

/**
 * Sponsor program data. A sponsor DISPLAYS (rotator + thank-you page) only while
 * status='active' AND today is within [start_date, end_date]. Past end_date it
 * drops out automatically via this query — no cron / manual cleanup. Equal
 * treatment: the display only ever exposes name + logo_url, never tiers or
 * amounts. Internal fields (contact_email, vetting_notes, amount, stripe ref)
 * stay server-side.
 */

export interface PublicSponsor {
  id: string;
  name: string;
  logo_url: string;
}

export interface AdminSponsor extends PublicSponsor {
  contact_email: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string;
  vetting_notes: string | null;
  amount_cents: number | null;
  stripe_customer_id: string | null;
  billing_note: string | null;
  created_at: string;
  updated_at: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Public-safe: the sponsors currently live for display (name + logo only). */
export async function getActiveSponsors(): Promise<PublicSponsor[]> {
  const admin = getSupabaseAdmin();
  const t = today();
  const { data, error } = await admin
    .from("igy_sponsors")
    .select("id, name, logo_url")
    .eq("status", "active")
    .or(`start_date.is.null,start_date.lte.${t}`)
    .or(`end_date.is.null,end_date.gte.${t}`)
    .order("name", { ascending: true });
  if (error) throw new Error(`active_sponsors_query_failed: ${error.message}`);
  return (data ?? []) as PublicSponsor[];
}

/** Admin: every sponsor, all fields, newest first. */
export async function listSponsors(): Promise<AdminSponsor[]> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("igy_sponsors")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`sponsors_query_failed: ${error.message}`);
  return (data ?? []) as AdminSponsor[];
}

export interface SponsorInput {
  name: string;
  logo_url: string;
  contact_email?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status?: string;
  vetting_notes?: string | null;
  amount_cents?: number | null;
  stripe_customer_id?: string | null;
  billing_note?: string | null;
}

const STATUSES = new Set(["pending_review", "active", "expired"]);

export async function createSponsor(input: SponsorInput): Promise<AdminSponsor> {
  const admin = getSupabaseAdmin();
  if (!input.name?.trim()) throw new Error("sponsor name is required");
  if (!input.logo_url?.trim()) throw new Error("logo_url is required");
  const status = input.status && STATUSES.has(input.status) ? input.status : "pending_review";
  const { data, error } = await admin
    .from("igy_sponsors")
    .insert({
      name: input.name.trim(),
      logo_url: input.logo_url.trim(),
      contact_email: input.contact_email?.trim() || null,
      start_date: input.start_date || null,
      end_date: input.end_date || null,
      status,
      vetting_notes: input.vetting_notes?.trim() || null,
      amount_cents: input.amount_cents ?? null,
      stripe_customer_id: input.stripe_customer_id?.trim() || null,
      billing_note: input.billing_note?.trim() || null,
    })
    .select("*")
    .single();
  if (error) throw new Error(`sponsor_insert_failed: ${error.message}`);
  return data as AdminSponsor;
}

/** Partial update — used for edit, vetting (pending_review -> active), expire. */
export async function updateSponsor(id: string, patch: Partial<SponsorInput>): Promise<AdminSponsor> {
  const admin = getSupabaseAdmin();
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) row.name = patch.name.trim();
  if (patch.logo_url !== undefined) row.logo_url = patch.logo_url.trim();
  if (patch.contact_email !== undefined) row.contact_email = patch.contact_email?.trim() || null;
  if (patch.start_date !== undefined) row.start_date = patch.start_date || null;
  if (patch.end_date !== undefined) row.end_date = patch.end_date || null;
  if (patch.status !== undefined) {
    if (!STATUSES.has(patch.status)) throw new Error("invalid status");
    row.status = patch.status;
  }
  if (patch.vetting_notes !== undefined) row.vetting_notes = patch.vetting_notes?.trim() || null;
  if (patch.amount_cents !== undefined) row.amount_cents = patch.amount_cents ?? null;
  if (patch.stripe_customer_id !== undefined) row.stripe_customer_id = patch.stripe_customer_id?.trim() || null;
  if (patch.billing_note !== undefined) row.billing_note = patch.billing_note?.trim() || null;

  const { data, error } = await admin.from("igy_sponsors").update(row).eq("id", id).select("*").single();
  if (error) throw new Error(`sponsor_update_failed: ${error.message}`);
  return data as AdminSponsor;
}
