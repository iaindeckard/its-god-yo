import "server-only";
import { getSupabaseAdmin } from "../supabaseAdmin";
import { OUTREACH, isGeneralAddress } from "./config";
import type { SizeBucket } from "./campaigns";

export type LeadStatus =
  | "active" | "converted" | "unsubscribed" | "bounced_hard" | "needs_review" | "aged_out" | "staged";

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
  // Nature of the org: 'school' for the Catholic K-12 Schools campaign, 'church' or
  // null for the church/youth-ministry pipeline. Drives school-aware verification
  // and the send/email variant.
  entity_type: "church" | "school" | null;
  status: LeadStatus;
  promo_code: string | null;
  promo_promotion_code_id: string | null;
  send_count: number;
  last_sent_at: string | null;
  // Campaign / geo / size (Phase 1). Null on legacy (global-cron) leads.
  campaign_id: string | null;
  latitude: number | null;
  longitude: number | null;
  geocoded_at: string | null;
  estimated_attendance: number | null;
  attendance_source_url: string | null;
  size_bucket: SizeBucket;
  // Pre-send verification (source-page + email/MX). Orthogonal to `status`: a lead
  // can be active-but-unverified. See lib/outreach/verify.ts + the send gate.
  verification_status: "unverified" | "passed" | "failed" | "needs_manual" | "manual_override";
  verified_at: string | null;
  verification_notes: Record<string, unknown> | null;
}

const TABLE = "igy_outreach_leads";

/** Optional scoping for a send. When campaignId is given the send targets ONLY
 *  that campaign's active leads (isolated per-campaign send), optionally narrowed
 *  to specific size buckets. Omitted => today's behavior (all active leads). */
export interface SendScope {
  campaignId?: string;
  sizeBuckets?: string[];
  leadIds?: string[];
}

/** Active leads eligible for a send (spec §1: status='active' is the ONLY gate —
 *  converted/unsubscribed/bounced/aged_out/needs_review/staged are all excluded).
 *  An optional scope isolates the send to one campaign (+ size buckets). */
export async function fetchActiveLeads(scope?: SendScope): Promise<OutreachLead[]> {
  const admin = getSupabaseAdmin();
  let q = admin.from(TABLE).select("*").eq("status", "active");
  if (scope?.campaignId) q = q.eq("campaign_id", scope.campaignId);
  if (scope?.sizeBuckets && scope.sizeBuckets.length) q = q.in("size_bucket", scope.sizeBuckets);
  if (scope?.leadIds && scope.leadIds.length) q = q.in("id", scope.leadIds);
  const { data, error } = await q.order("first_found_at", { ascending: true });
  if (error) throw new Error(`fetch_active_failed: ${error.message}`);
  return (data ?? []) as OutreachLead[];
}

/** All leads in a campaign, any status — for the admin campaign detail view. */
export async function fetchCampaignLeads(campaignId: string): Promise<OutreachLead[]> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from(TABLE)
    .select("*")
    .eq("campaign_id", campaignId)
    .order("size_bucket", { ascending: true })
    .order("org_name", { ascending: true });
  if (error) throw new Error(`fetch_campaign_leads_failed: ${error.message}`);
  return (data ?? []) as OutreachLead[];
}

/**
 * Promote a selected subset of a campaign's STAGED leads into the send
 * pipeline (staged -> active). This is the gate the spec requires: nothing in a
 * campaign sends until it is promoted here. Either promote specific ids, or all
 * staged leads in the given size buckets. Only freshly verified rows currently
 * 'staged' in this campaign move — never a held, stale, suppressed, converted,
 * or already-active row. Returns the number promoted.
 */
export async function promoteLeads(
  campaignId: string,
  opts: { sizeBuckets?: string[]; ids?: string[] },
): Promise<number> {
  const admin = getSupabaseAdmin();
  const freshAfter = new Date(Date.now() - 90 * 86_400_000).toISOString();
  let q = admin
    .from(TABLE)
    .update({ status: "active", updated_at: new Date().toISOString() })
    .eq("campaign_id", campaignId)
    .eq("status", "staged")
    // Promotion is itself a safety boundary. A caller cannot move a failed,
    // needs-manual, unverified, or stale lead into the active send pipeline.
    .in("verification_status", ["passed", "manual_override"])
    .gte("verified_at", freshAfter);
  if (opts.ids && opts.ids.length) {
    q = q.in("id", opts.ids);
  } else if (opts.sizeBuckets && opts.sizeBuckets.length) {
    q = q.in("size_bucket", opts.sizeBuckets);
  }
  const { data, error } = await q.select("id");
  if (error) throw new Error(`promote_leads_failed: ${error.message}`);
  return (data ?? []).length;
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

/** Look up a lead by the address we emailed, to attribute an inbound reply to its
 *  org. Case-insensitive exact match on contact_email. Returns just the id + name
 *  (all the reply notification needs) or null when the reply is from someone we
 *  don't have a lead for (e.g. a manual outreach recipient, or a reply from a
 *  different address than we mailed) — the caller still flags it, just generically. */
export async function findLeadByContactEmail(
  email: string,
): Promise<Pick<OutreachLead, "id" | "org_name"> | null> {
  const clean = email.trim().toLowerCase();
  if (!clean) return null;
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from(TABLE)
    .select("id, org_name")
    .ilike("contact_email", clean)
    .limit(1)
    .maybeSingle();
  return (data as Pick<OutreachLead, "id" | "org_name"> | null) ?? null;
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

export async function replaceLeadContactEmail(
  lead: OutreachLead,
  input: { email: string; sourceUrl: string; actorUserId: string; manuallyConfirmed: boolean; automatedEvidenceConfirmed: boolean },
): Promise<void> {
  if (!lead.campaign_id || !["staged", "active", "needs_review"].includes(lead.status)) {
    throw new Error("contact_email_edit_not_allowed");
  }
  const now = new Date().toISOString();
  const priorNotes = lead.verification_notes ?? {};
  const priorEdits = Array.isArray(priorNotes.contact_email_edits) ? priorNotes.contact_email_edits : [];
  const sourceUrls = [input.sourceUrl, ...(Array.isArray(lead.source_urls) ? lead.source_urls : [])];
  const { error } = await getSupabaseAdmin().from(TABLE).update({
    contact_email: input.email,
    source_urls: [...new Set(sourceUrls)],
    verification_status: input.automatedEvidenceConfirmed ? "unverified" : "needs_manual",
    verified_at: null,
    verification_notes: {
      ...priorNotes,
      contact_email_edits: [...priorEdits, {
        from: lead.contact_email,
        to: input.email,
        source_url: input.sourceUrl,
        changed_by: input.actorUserId,
        changed_at: now,
        manually_confirmed: input.manuallyConfirmed,
        automated_evidence_confirmed: input.automatedEvidenceConfirmed,
      }],
    },
    updated_at: now,
  }).eq("id", lead.id);
  if (error?.code === "23505") throw new Error("contact_email_already_exists");
  if (error) throw new Error(`contact_email_update_failed: ${error.message}`);
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
  // 'school' for Catholic-schools discovery; omitted/null for the church pipeline.
  entity_type?: "church" | "school" | null;
  // Candidate provenance is separate from qualification evidence. An official
  // denominational directory establishes that the congregation exists; its own
  // public pages must still establish the office email and active youth ministry.
  directory_source_url?: string | null;
  contact_source_url?: string | null;
  youth_source_url?: string | null;
  discovery_method?: "official_directory" | "secondary_web";
  discovery_confidence?: "high" | "medium" | "low";
  // Attendance-based sizing (from the discovery pass; null/unknown when a public
  // figure isn't found — never guessed).
  estimated_attendance?: number | null;
  attendance_source_url?: string | null;
  // Enriched by runCampaignDiscovery before insert (geocode + radius membership).
  latitude?: number | null;
  longitude?: number | null;
  size_bucket?: SizeBucket;
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
export async function insertDiscovered(
  leads: DiscoveredLead[],
  campaignId: string | null = null,
): Promise<{ inserted: number; skipped: number; insertedIds: string[] }> {
  const admin = getSupabaseAdmin();
  let inserted = 0;
  let skipped = 0;
  const insertedIds: string[] = [];
  for (const l of leads) {
    const email = l.contact_email?.trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { skipped++; continue; }
    // Office-inbox enforcement applies to BOTH providers (this insert path is
    // shared) and BOTH pipelines. A non-role / personal address is never
    // send-clean: it routes to needs_review so a human fixes or clears it first.
    const notOfficeInbox = !isGeneralAddress(email);
    // Campaign leads are born 'staged' (NOT send-eligible) — they only enter the
    // send pipeline when an admin promotes a size-filtered subset — EXCEPT when the
    // address isn't a recognized office inbox, which routes to needs_review instead
    // of staged-clean. Legacy/global-cron leads keep the original active-vs-
    // needs_review routing (low confidence OR non-office-inbox -> needs_review).
    const weakLegacy = l.discovery_confidence === "low" || notOfficeInbox;
    const status = campaignId
      ? (notOfficeInbox ? "needs_review" : "staged")
      : (weakLegacy ? "needs_review" : "active");
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
      entity_type: l.entity_type ?? null,
      status,
      campaign_id: campaignId,
      latitude: l.latitude ?? null,
      longitude: l.longitude ?? null,
      geocoded_at: l.latitude != null && l.longitude != null ? new Date().toISOString() : null,
      estimated_attendance: l.estimated_attendance ?? null,
      attendance_source_url: l.attendance_source_url ?? null,
      size_bucket: l.size_bucket ?? "unknown",
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
    insertedIds.push(data[0].id);
  }
  return { inserted, skipped, insertedIds };
}

export const AGE_OUT_LIMIT = OUTREACH.ageOutSends;
