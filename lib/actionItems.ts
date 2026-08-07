import "server-only";
import { getSupabaseAdmin } from "./supabaseAdmin";

/**
 * Ops "action items" queue (igy_action_items) — persists manual-review states that
 * previously only fired an ops email, so they surface on the admin landing page as
 * real, resolvable attention items. One generic kind-discriminated table; add a new
 * `kind` for a new actionable state.
 *
 *  - failed_billing : a subscription's charge failed (trial-end / renewal dunning).
 *                     Deduped per subscription; auto-resolves when a later invoice
 *                     for the same sub is paid.
 *  - dispute_review : a chargeback we WON — needs a manual reinstatement decision.
 *                     Deduped per dispute.
 */
export type ActionItemKind = "failed_billing" | "dispute_review";

export interface ActionItem {
  id: string;
  kind: ActionItemKind;
  status: "open" | "resolved";
  dedupe_key: string;
  title: string;
  detail: string | null;
  pending_signup_id: string | null;
  stripe_customer_id: string | null;
  stripe_charge_id: string | null;
  stripe_dispute_id: string | null;
  stripe_subscription_id: string | null;
  amount_cents: number | null;
  currency: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  resolved_at: string | null;
}

export interface RecordActionItemInput {
  kind: ActionItemKind;
  dedupeKey: string;
  title: string;
  detail?: string | null;
  pendingSignupId?: string | null;
  stripeCustomerId?: string | null;
  stripeChargeId?: string | null;
  stripeDisputeId?: string | null;
  stripeSubscriptionId?: string | null;
  amountCents?: number | null;
  currency?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Insert an OPEN action item, idempotent on dedupe_key (the partial unique index
 * blocks a second OPEN row for the same event -> 23505, treated as a no-op).
 * Best-effort: a failure here must never break the webhook/caller flow.
 */
export async function recordActionItem(input: RecordActionItemInput): Promise<void> {
  try {
    const admin = getSupabaseAdmin();
    const { error } = await admin.from("igy_action_items").insert({
      kind: input.kind,
      status: "open",
      dedupe_key: input.dedupeKey,
      title: input.title,
      detail: input.detail ?? null,
      pending_signup_id: input.pendingSignupId ?? null,
      stripe_customer_id: input.stripeCustomerId ?? null,
      stripe_charge_id: input.stripeChargeId ?? null,
      stripe_dispute_id: input.stripeDisputeId ?? null,
      stripe_subscription_id: input.stripeSubscriptionId ?? null,
      amount_cents: input.amountCents ?? null,
      currency: input.currency ?? null,
      metadata: input.metadata ?? {},
    });
    if (error && error.code !== "23505") {
      console.error(`[actionItems] record ${input.kind} failed:`, error.message);
    }
  } catch (e) {
    console.error("[actionItems] record threw:", e instanceof Error ? e.message : e);
  }
}

/** Resolve one item by id (from the landing-page resolve action). Returns true if
 *  an OPEN item was actually moved (idempotent — a second call is a no-op). */
export async function resolveActionItem(id: string, resolvedBy: string | null, note?: string): Promise<boolean> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("igy_action_items")
    .update({ status: "resolved", resolved_at: new Date().toISOString(), resolved_by: resolvedBy, resolution_note: note ?? null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "open")
    .select("id");
  if (error) throw new Error(`resolve_failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/** Auto-resolve any OPEN item for a dedupe_key (e.g. dunning recovered -> clear the
 *  failed_billing item). Best-effort. */
export async function resolveOpenByDedupe(dedupeKey: string): Promise<void> {
  try {
    const admin = getSupabaseAdmin();
    await admin
      .from("igy_action_items")
      .update({ status: "resolved", resolved_at: new Date().toISOString(), resolution_note: "auto-resolved (event cleared)", updated_at: new Date().toISOString() })
      .eq("dedupe_key", dedupeKey)
      .eq("status", "open");
  } catch (e) {
    console.error("[actionItems] auto-resolve threw:", e instanceof Error ? e.message : e);
  }
}

/** All OPEN items (newest first), optionally filtered to one kind. */
export async function listOpenActionItems(kind?: ActionItemKind): Promise<ActionItem[]> {
  const admin = getSupabaseAdmin();
  let q = admin.from("igy_action_items").select("*").eq("status", "open").order("created_at", { ascending: false });
  if (kind) q = q.eq("kind", kind);
  const { data } = await q;
  return (data ?? []) as ActionItem[];
}
