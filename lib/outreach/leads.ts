import "server-only";
import { getSupabaseAdmin } from "../supabaseAdmin";
import { OUTREACH, isGeneralAddress } from "./config";

export type LeadStatus =
  | "active" | "converted" | "unsubscribed" | "bounced_hard" | "needs_review" | "aged_out";

export interface OutreachLead {
  id: string;
  org_name: string;
  city: string | null;
  state: string | null;
  denomination_type: string | null;
  contact_email: string;
  phone: string | null;
  website: string | null;
  youth_ministry_signal: string | null;
  source_urls: string[];
  discovery_confidence: "high" | "medium" | "low" | null;
  status: LeadStatus;
  promo_code: string | null;
  promo_promotion_code_id: string | null;
  send_count: number;
  last_sent_at: string | null;
}

const TABLE = "igy_outreach_leads";

/** Active leads eligible for a send (spec §1: status='active' is the ONLY gate —
 *  converted/unsubscribed/bounced/aged_out/needs_review are all excluded). */
export async function fetchActiveLeads(): Promise<OutreachLead[]> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from(TABLE)
    .select("*")
    .eq("status", "active")
    .order("first_found_at", { ascending: true });
  if (error) throw new Error(`fetch_active_failed: ${error.message}`);
  return (data ?? []) as OutreachLead[];
}

/** Record a successful send: stamp last_sent_at, bump send_count, and persist the
 *  minted promo code (first send only — reused on later sends). */
export async function recordSend(
  id: string,
  sendCount: number,
  promo: { code: string; promotionCodeId: string } | null,
): Promise<void> {
  const admin = getSupabaseAdmin();
  const patch: Record<string, unknown> = {
    last_sent_at: new Date().toISOString(),
    send_count: sendCount + 1,
    updated_at: new Date().toISOString(),
  };
  if (promo) {
    patch.promo_code = promo.code;
    patch.promo_promotion_code_id = promo.promotionCodeId;
  }
  const { error } = await admin.from(TABLE).update(patch).eq("id", id);
  if (error) throw new Error(`record_send_failed: ${error.message}`);
}

/** §7.3 — age a lead out (sent 6x, never converted). Kept, not deleted. */
export async function ageOut(id: string): Promise<void> {
  const admin = getSupabaseAdmin();
  await admin
    .from(TABLE)
    .update({ status: "aged_out", aged_out_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "active"); // never override a suppression that raced in
}

/**
 * Permanent suppression (spec §2). Real-time, idempotent. Matched by email so
 * both the one-click unsubscribe (has the lead id) and the provider bounce
 * webhook (has only the address) funnel here. We only move rows that are still
 * live — a converted/already-suppressed row is left as-is.
 */
export async function suppressByEmail(
  email: string,
  next: "unsubscribed" | "bounced_hard",
  reason?: string,
): Promise<number> {
  const admin = getSupabaseAdmin();
  const patch: Record<string, unknown> = { status: next, updated_at: new Date().toISOString() };
  if (next === "unsubscribed") patch.unsubscribed_at = new Date().toISOString();
  if (next === "bounced_hard") patch.bounce_reason = reason ?? "hard_bounce";
  const { data, error } = await admin
    .from(TABLE)
    .update(patch)
    .eq("contact_email", email.trim().toLowerCase())
    .in("status", ["active", "needs_review"])
    .select("id");
  if (error) throw new Error(`suppress_failed: ${error.message}`);
  return (data ?? []).length;
}

export async function getLead(id: string): Promise<OutreachLead | null> {
  const admin = getSupabaseAdmin();
  const { data } = await admin.from(TABLE).select("*").eq("id", id).maybeSingle();
  return (data as OutreachLead) ?? null;
}

/** Conversion (spec §5). Matched by the Stripe promotion_code id we stored at
 *  mint time. Idempotent: only the first matching redemption sticks. */
export async function markConvertedByPromotionCodeId(
  promotionCodeId: string,
  valueCents: number | null,
): Promise<number> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from(TABLE)
    .update({
      status: "converted",
      converted_at: new Date().toISOString(),
      conversion_value_cents: valueCents,
      updated_at: new Date().toISOString(),
    })
    .eq("promo_promotion_code_id", promotionCodeId)
    .neq("status", "converted")
    .select("id");
  if (error) throw new Error(`convert_failed: ${error.message}`);
  return (data ?? []).length;
}

export interface DiscoveredLead {
  org_name: string;
  city?: string | null;
  state?: string | null;
  denomination_type?: string | null;
  contact_email: string;
  phone?: string | null;
  website?: string | null;
  youth_ministry_signal?: string | null;
  source_urls?: string[];
  discovery_confidence?: "high" | "medium" | "low";
}

/**
 * Insert freshly-discovered leads. Anti-resurrection is structural: the unique
 * index on lower(contact_email) means a rediscovered org (including one that
 * unsubscribed, bounced, converted, or aged out) hits ON CONFLICT DO NOTHING and
 * its existing row/status is left untouched — it is never re-added or reset.
 *
 * Confidence -> status: a 'low' confidence lead, OR one whose email isn't a
 * recognized general/office address (e.g. socialmedia@ — the Central Christian
 * case), lands in needs_review instead of active, held out of sends until a
 * human confirms it (spec §3).
 */
export async function insertDiscovered(leads: DiscoveredLead[]): Promise<{ inserted: number; skipped: number }> {
  const admin = getSupabaseAdmin();
  let inserted = 0;
  let skipped = 0;
  for (const l of leads) {
    const email = l.contact_email?.trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { skipped++; continue; }
    const weak = l.discovery_confidence === "low" || !isGeneralAddress(email);
    const row = {
      org_name: l.org_name?.trim(),
      city: l.city ?? null,
      state: l.state ?? null,
      denomination_type: l.denomination_type ?? null,
      contact_email: email,
      phone: l.phone ?? null,
      website: l.website ?? null,
      youth_ministry_signal: l.youth_ministry_signal ?? null,
      source_urls: l.source_urls ?? [],
      discovery_confidence: l.discovery_confidence ?? null,
      status: weak ? "needs_review" : "active",
    };
    if (!row.org_name) { skipped++; continue; }
    // Anti-resurrection: if this org (by email, case-insensitive) is already
    // known in ANY status, leave it untouched — never re-add or reset it. The
    // unique index on lower(contact_email) is the ultimate backstop if two runs
    // race (the loser's insert raises a unique violation, caught below).
    const { data: existing } = await admin
      .from(TABLE).select("id").eq("contact_email", email).limit(1);
    if (existing && existing.length) { skipped++; continue; }
    const { data, error } = await admin.from(TABLE).insert(row).select("id");
    if (error || !data?.length) { skipped++; continue; }
    inserted++;
  }
  return { inserted, skipped };
}

export const AGE_OUT_LIMIT = OUTREACH.ageOutSends;
