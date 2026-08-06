import "server-only";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared subscription_payments row-building + idempotent upsert.
 *
 * Both writers of the ledger go through here so they produce BYTE-IDENTICAL rows
 * and share the same idempotency (unique on balance_transaction_id):
 *   - the Stripe webhook (event-driven: invoice.paid / charge.refunded /
 *     charge.dispute.created) — app/api/stripe/webhook/route.ts
 *   - the reconciliation cron (Stripe-list-driven safety net) —
 *     app/api/cron/reconcile-payments/route.ts
 *
 * Keeping the mapping in one place is what makes the reconcile job a true backfill
 * for the webhook rather than a second, subtly-different writer.
 */

export type PaymentKind = "charge" | "refund" | "dispute";

/** Unix seconds → ISO string, or null. */
export const tsIso = (unix: number | null | undefined): string | null =>
  typeof unix === "number" ? new Date(unix * 1000).toISOString() : null;

/**
 * Everything needed to build one subscription_payments row from a Stripe balance
 * transaction. Settled_* come off the balance transaction (signed, GROSS);
 * original_* are the presentment pair.
 */
export interface PaymentCapture {
  kind: PaymentKind;
  bt: Stripe.BalanceTransaction | null;
  originalAmountCents: number | null;
  originalCurrency: string | null;
  chargeId: string | null;
  invoiceId: string | null;
  paymentIntentId: string | null;
  subscriptionId: string | null;
  customerId: string | null;
  billingReason: string | null;
  status: string;
  periodStart: string | null;
  periodEnd: string | null;
}

/** Map a capture (balance transaction + context) to a subscription_payments row. */
export function buildPaymentRow(p: PaymentCapture, bt: Stripe.BalanceTransaction) {
  return {
    business_unit: "igy",
    // Stripe's own test/live signal, stamped from the balance transaction so test
    // artifacts (e.g. test clocks) can never silently count as revenue. The DEI
    // ETL / rollup counts only livemode=true. (Migration 20260806000001.)
    livemode: (bt as unknown as { livemode: boolean }).livemode,
    kind: p.kind,
    balance_transaction_id: bt.id,
    stripe_charge_id: p.chargeId,
    stripe_invoice_id: p.invoiceId,
    stripe_payment_intent_id: p.paymentIntentId,
    stripe_subscription_id: p.subscriptionId,
    stripe_customer_id: p.customerId,
    original_amount_cents: p.originalAmountCents,
    original_currency: p.originalCurrency,
    settled_amount_cents: bt.amount ?? null, // GROSS settled, signed (charge +, refund/dispute -)
    settled_currency: bt.currency ?? null,
    settled_fee_cents: bt.fee ?? null,
    settled_net_cents: bt.net ?? null,
    exchange_rate: bt.exchange_rate ?? null,
    billing_reason: p.billingReason,
    status: p.status,
    period_start: p.periodStart,
    period_end: p.periodEnd,
    stripe_created_at: tsIso(bt.created),
  };
}

/**
 * Idempotent upsert of one ledger row (ON CONFLICT (balance_transaction_id) DO
 * NOTHING). Returns whether a NEW row was inserted — the reconcile job uses this
 * to count backfilled gaps (a webhook re-delivery or a re-scanned window both
 * return inserted:false). Throws on a DB error so the caller decides how to react
 * (the webhook wraps this in safeCapture; the reconcile cron logs per row).
 */
export async function upsertSubscriptionPayment(
  admin: SupabaseClient,
  p: PaymentCapture,
): Promise<{ inserted: boolean }> {
  const bt = p.bt;
  if (!bt?.id) {
    // No settlement record → nothing canonical to store.
    console.warn(`[subscription_payments] no balance_transaction for ${p.kind} charge=${p.chargeId ?? "?"} — skipped`);
    return { inserted: false };
  }
  const { data, error } = await admin
    .from("subscription_payments")
    .upsert(buildPaymentRow(p, bt), { onConflict: "balance_transaction_id", ignoreDuplicates: true })
    .select("balance_transaction_id");
  if (error) throw error;
  return { inserted: (data?.length ?? 0) > 0 };
}
