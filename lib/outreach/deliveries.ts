import "server-only";
import crypto from "crypto";
import { getSupabaseAdmin } from "../supabaseAdmin";
import { eventOccurredAt, lifecycleStatus, providerMessageId } from "./delivery-events-core";

const TABLE = "outreach_campaign_deliveries";
const EVENTS_TABLE = "outreach_delivery_events";
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
  if (!existing || !["claimed", "failed"].includes(existing.status)) return null;
  const stale = Date.now() - new Date(existing.claimed_at).getTime() >= STALE_CLAIM_MS;
  if (existing.status === "claimed" && !stale) return null;
  const { data: reclaimed } = await admin.from(TABLE).update({
    status: "claimed", claim_token: token, claimed_at: new Date().toISOString(), updated_at: new Date().toISOString(), error: null,
  }).eq("id", existing.id).eq("claim_token", existing.claim_token).select("id").maybeSingle();
  return reclaimed ? { id: reclaimed.id, token, idempotencyKey: `outreach/${campaignId}/${leadId}/${touch}` } : null;
}

export async function markDeliverySent(claim: DeliveryClaim, providerMessageId: string): Promise<void> {
  const admin = getSupabaseAdmin();
  const { error } = await admin.from(TABLE).update({
    status: "sent", provider_message_id: providerMessageId, sent_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", claim.id).eq("claim_token", claim.token);
  if (error) throw new Error(`mark_delivery_sent_failed: ${error.message}`);

  const { data: pending, error: pendingError } = await admin.from(EVENTS_TABLE)
    .select("id,event_type,occurred_at")
    .eq("provider_message_id", providerMessageId)
    .is("delivery_id", null)
    .order("occurred_at", { ascending: true });
  if (pendingError) throw new Error(`find_pending_delivery_events_failed: ${pendingError.message}`);
  for (const event of pending ?? []) {
    await applyDeliveryEvent(admin, claim.id, event.id, event.event_type, event.occurred_at);
  }
}

export async function markDeliveryFailed(claim: DeliveryClaim, errorMessage: string): Promise<void> {
  await getSupabaseAdmin().from(TABLE).update({
    status: "failed", error: errorMessage.slice(0, 500), updated_at: new Date().toISOString(),
  }).eq("id", claim.id).eq("claim_token", claim.token);
}

export interface ResendDeliveryEvent {
  type?: string;
  created_at?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

async function applyDeliveryEvent(
  admin: SupabaseAdmin,
  deliveryId: string,
  eventId: string,
  eventType: string,
  occurredAt: string,
): Promise<string | null> {
  const { error: linkError } = await admin.from(EVENTS_TABLE).update({ delivery_id: deliveryId }).eq("id", eventId);
  if (linkError) throw new Error(`link_delivery_event_failed: ${linkError.message}`);

  const status = lifecycleStatus(eventType);
  if (!status) return null;
  const { data: delivery, error: lookupError } = await admin.from(TABLE)
    .select("last_event_at")
    .eq("id", deliveryId)
    .maybeSingle();
  if (lookupError || !delivery) throw new Error(`find_delivery_for_event_failed: ${lookupError?.message ?? "not found"}`);
  const timestampColumn: Partial<Record<typeof status, string>> = {
    delivered: "delivered_at", delayed: "delayed_at", bounced: "bounced_at",
    complained: "complained_at", suppressed: "suppressed_at",
  };
  const patch: Record<string, unknown> = {
    last_event_at: occurredAt,
    last_event_type: eventType,
    updated_at: new Date().toISOString(),
  };
  const previous = delivery.last_event_at ? new Date(delivery.last_event_at).getTime() : -Infinity;
  if (new Date(occurredAt).getTime() >= previous) patch.status = status;
  const column = timestampColumn[status];
  if (column) patch[column] = occurredAt;
  const { error: updateError } = await admin.from(TABLE).update(patch).eq("id", deliveryId);
  if (updateError) throw new Error(`update_delivery_lifecycle_failed: ${updateError.message}`);
  return status;
}

/** Persist one signed Resend event and update its matching scheduler delivery.
 * Svix event ids are unique, making provider retries and manual replays harmless. */
export async function recordDeliveryEvent(providerEventId: string, event: ResendDeliveryEvent): Promise<{
  duplicate: boolean; matched: boolean; status: string | null;
}> {
  const admin = getSupabaseAdmin();
  const eventType = typeof event.type === "string" ? event.type : "unknown";
  const messageId = providerMessageId(event.data);
  const occurredAt = eventOccurredAt(event.created_at);
  const inserted = await admin.from(EVENTS_TABLE).insert({
    provider_event_id: providerEventId,
    provider_message_id: messageId,
    event_type: eventType,
    occurred_at: occurredAt,
    payload: event,
  }).select("id").maybeSingle();
  const duplicate = inserted.error?.code === "23505";
  let eventId = inserted.data?.id as string | undefined;
  if (duplicate) {
    const { data: existing, error: existingError } = await admin.from(EVENTS_TABLE)
      .select("id")
      .eq("provider_event_id", providerEventId)
      .maybeSingle();
    if (existingError || !existing) throw new Error(`find_duplicate_delivery_event_failed: ${existingError?.message ?? "not found"}`);
    eventId = existing.id;
  } else if (inserted.error || !eventId) {
    throw new Error(`record_delivery_event_failed: ${inserted.error?.message ?? "unknown"}`);
  }
  if (!eventId) throw new Error("record_delivery_event_failed: event id missing");
  if (!messageId) return { duplicate, matched: false, status: lifecycleStatus(eventType) };

  const { data: delivery, error: lookupError } = await admin.from(TABLE)
    .select("id,last_event_at")
    .eq("provider_message_id", messageId)
    .maybeSingle();
  if (lookupError) throw new Error(`find_delivery_for_event_failed: ${lookupError.message}`);
  if (!delivery) return { duplicate, matched: false, status: lifecycleStatus(eventType) };

  const status = await applyDeliveryEvent(admin, delivery.id, eventId, eventType, occurredAt);
  return { duplicate, matched: true, status };
}

export interface CampaignDelivery {
  id: string; lead_id: string; touch: number; status: string; provider_message_id: string | null;
  error: string | null; sent_at: string | null; delivered_at: string | null; delayed_at: string | null;
  bounced_at: string | null; complained_at: string | null; suppressed_at: string | null;
  last_event_at: string | null; last_event_type: string | null;
}

export async function listCampaignDeliveries(campaignId: string): Promise<CampaignDelivery[]> {
  const { data, error } = await getSupabaseAdmin().from(TABLE).select(
    "id,lead_id,touch,status,provider_message_id,error,sent_at,delivered_at,delayed_at,bounced_at,complained_at,suppressed_at,last_event_at,last_event_type",
  ).eq("campaign_id", campaignId).order("claimed_at", { ascending: false });
  if (error) throw new Error(`list_campaign_deliveries_failed: ${error.message}`);
  return (data ?? []) as CampaignDelivery[];
}
