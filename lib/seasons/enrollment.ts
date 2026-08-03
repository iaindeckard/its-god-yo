import type { SupabaseClient } from "@supabase/supabase-js";
import type { SeasonKey } from "./liturgical";
import { SEASON_KEYS } from "./catalog";

/**
 * Phase E — season enrollment (purchase) + toggle. Whole-family only (no per-child
 * selection — deferred per spec). One enrollment row per (Stripe customer, season);
 * enrolling and toggling are the same idempotent upsert, mirroring the DM-from-Him
 * whole-family flag pattern. The pre-season cron (Phase B) does the actual charging;
 * this only records intent + auto-renew.
 */

export interface SeasonEnrollmentRow {
  season_key: SeasonKey;
  status: "active" | "canceled";
  auto_renew: boolean;
  quantity: number;
  stripe_payment_method_id: string | null;
}

/** Enroll (active=true) or toggle off (active=false) a whole-family season. Idempotent. */
export async function setSeasonEnrollment(
  db: SupabaseClient,
  args: {
    customerId: string;
    seasonKey: SeasonKey;
    active: boolean;
    autoRenew?: boolean;
    quantity?: number;
    paymentMethodId?: string | null;
  },
): Promise<SeasonEnrollmentRow> {
  if (!SEASON_KEYS.includes(args.seasonKey)) throw new Error(`unknown season ${args.seasonKey}`);
  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    stripe_customer_id: args.customerId,
    season_key: args.seasonKey,
    status: args.active ? "active" : "canceled",
    updated_at: now,
    canceled_at: args.active ? null : now,
  };
  if (args.autoRenew !== undefined) row.auto_renew = args.autoRenew;
  if (args.quantity !== undefined) row.quantity = args.quantity;
  if (args.paymentMethodId !== undefined) row.stripe_payment_method_id = args.paymentMethodId;

  const { data, error } = await db
    .from("season_enrollments")
    .upsert(row, { onConflict: "stripe_customer_id,season_key" })
    .select("season_key, status, auto_renew, quantity, stripe_payment_method_id")
    .single();
  if (error) throw new Error(`setSeasonEnrollment failed: ${error.message}`);
  return data as SeasonEnrollmentRow;
}

/** All season enrollments for a customer, keyed by season (for the toggle UI). */
export async function getCustomerEnrollments(
  db: SupabaseClient,
  customerId: string,
): Promise<Record<string, SeasonEnrollmentRow>> {
  const { data, error } = await db
    .from("season_enrollments")
    .select("season_key, status, auto_renew, quantity, stripe_payment_method_id")
    .eq("stripe_customer_id", customerId);
  if (error) throw new Error(`getCustomerEnrollments failed: ${error.message}`);
  const out: Record<string, SeasonEnrollmentRow> = {};
  for (const r of (data ?? []) as SeasonEnrollmentRow[]) out[r.season_key] = r;
  return out;
}
