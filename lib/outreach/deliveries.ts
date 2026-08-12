import "server-only";
import crypto from "crypto";
import { getSupabaseAdmin } from "../supabaseAdmin";

const TABLE = "outreach_campaign_deliveries";
const STALE_CLAIM_MS = 10 * 60 * 1000;

export interface DeliveryClaim { id: string; token: string; idempotencyKey: string }

/** Claim one campaign/lead/touch. The unique key prevents overlapping cron runs. */
export async function claimDelivery(campaignId: string, leadId: string, touch: 1 | 2): Promise<DeliveryClaim | null> {
  const admin = getSupabaseAdmin();
  const token = crypto.randomUUID();
  const row = { campaign_id: campaignId, lead_id: leadId, touch, claim_token: token, status: "claimed" };
  const inserted = await admin.from(TABLE).insert(row).select("id").maybeSingle();
  if (!inserted.error && inserted.data) {
    return { id: inserted.data.id, token, idempotencyKey: `outreach/${campaignId}/${leadId}/${touch}` };
  }
  if (inserted.error?.code !== "23505") throw new Error(`claim_delivery_failed: ${inserted.error?.message ?? "unknown"}`);
  const { data: existing } = await admin.from(TABLE).select("id,status,claimed_at,claim_token").eq("campaign_id", campaignId).eq("lead_id", leadId).eq("touch", touch).maybeSingle();
  if (!existing || existing.status === "sent") return null;
  const stale = Date.now() - new Date(existing.claimed_at).getTime() >= STALE_CLAIM_MS;
  if (existing.status === "claimed" && !stale) return null;
  const { data: reclaimed } = await admin.from(TABLE).update({
    status: "claimed", claim_token: token, claimed_at: new Date().toISOString(), updated_at: new Date().toISOString(), error: null,
  }).eq("id", existing.id).eq("claim_token", existing.claim_token).select("id").maybeSingle();
  return reclaimed ? { id: reclaimed.id, token, idempotencyKey: `outreach/${campaignId}/${leadId}/${touch}` } : null;
}

export async function markDeliverySent(claim: DeliveryClaim, providerMessageId: string): Promise<void> {
  const { error } = await getSupabaseAdmin().from(TABLE).update({
    status: "sent", provider_message_id: providerMessageId, sent_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", claim.id).eq("claim_token", claim.token);
  if (error) throw new Error(`mark_delivery_sent_failed: ${error.message}`);
}

export async function markDeliveryFailed(claim: DeliveryClaim, errorMessage: string): Promise<void> {
  await getSupabaseAdmin().from(TABLE).update({
    status: "failed", error: errorMessage.slice(0, 500), updated_at: new Date().toISOString(),
  }).eq("id", claim.id).eq("claim_token", claim.token);
}
