import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { seasonWindows, addDays, iso, type SeasonKey, type CalDate } from "./liturgical";
import { SEASON_PRODUCTS } from "./catalog";

/**
 * Phase B — moving-date off-session season billing.
 *
 * Season add-ons are NOT Stripe subscriptions (Stripe can't renew on a lunar date).
 * Each year, a few days before a season's (moving) start date, this charges the
 * saved card off-session for every active enrollment — once. Idempotency is
 * claim-first: we INSERT a season_charges row keyed UNIQUE(enrollment, season_year)
 * before charging, so a re-run conflicts and skips; the Stripe idempotencyKey is a
 * second backstop. HARD content-readiness gate: never charge unless that season's
 * batch is `approved` (Iain, 2026-08-03) — charging for content that isn't ready to
 * send would break the transparency the product is sold on.
 *
 * Clients are injected so the whole thing is testable outside a server context.
 */

/** Charge fires this many days before the season's start date. */
export const SEASON_CHARGE_LEAD_DAYS = 3;

export interface SeasonBillingDeps {
  db: SupabaseClient;
  stripe: Stripe;
  /** "today" — the cron passes now(); tests pin it. */
  today: CalDate;
  leadDays?: number;
  dryRun?: boolean;
}

export interface DueOccurrence {
  seasonYear: number;
  seasonStart: CalDate;
  chargeDate: CalDate;
}

/**
 * The season occurrence whose charge window [chargeDate, seasonStart] contains
 * `today`, or null if today is outside every window. Checks the years around today
 * so the Dec→Jan Christmastide boundary is handled. Charging stops at seasonStart
 * (never charge after the season has already begun).
 */
export function dueOccurrence(season: SeasonKey, today: CalDate, leadDays: number): DueOccurrence | null {
  const t = iso(today);
  for (const y of [today.year - 1, today.year, today.year + 1]) {
    const seasonStart = seasonWindows(y)[season].start;
    const chargeDate = addDays(seasonStart, -leadDays);
    if (iso(chargeDate) <= t && t <= iso(seasonStart)) {
      return { seasonYear: y, seasonStart, chargeDate };
    }
  }
  return null;
}

export type BillingAction =
  | "no_op_outside_window"
  | "skipped_content_not_ready"
  | "already_charged_skip"
  | "would_charge"
  | "charged"
  | "charge_failed";

export interface BillingResult {
  enrollmentId: string;
  season: SeasonKey;
  seasonYear?: number;
  action: BillingAction;
  amountCents?: number;
  paymentIntentId?: string | null;
  error?: string | null;
}

export async function runSeasonBilling(deps: SeasonBillingDeps): Promise<BillingResult[]> {
  const { db, stripe, today, dryRun = false } = deps;
  const leadDays = deps.leadDays ?? SEASON_CHARGE_LEAD_DAYS;
  const results: BillingResult[] = [];

  const { data: enrollments, error } = await db
    .from("season_enrollments")
    .select("id, stripe_customer_id, season_key, quantity, stripe_payment_method_id")
    .eq("status", "active")
    .eq("auto_renew", true);
  if (error) throw new Error(`season_enrollments query failed: ${error.message}`);

  for (const en of enrollments ?? []) {
    const season = en.season_key as SeasonKey;
    const occ = dueOccurrence(season, today, leadDays);
    if (!occ) {
      results.push({ enrollmentId: en.id, season, action: "no_op_outside_window" });
      continue;
    }

    // HARD content-readiness gate — never charge for a batch that isn't approved.
    const { data: batch } = await db
      .from("season_content_batches")
      .select("status")
      .eq("season_key", season)
      .eq("liturgical_year", occ.seasonYear)
      .maybeSingle();
    if (batch?.status !== "approved") {
      results.push({ enrollmentId: en.id, season, seasonYear: occ.seasonYear, action: "skipped_content_not_ready" });
      continue;
    }

    const quantity: number = en.quantity ?? 1;
    const amountCents = SEASON_PRODUCTS[season].unitAmountCents * quantity;

    if (dryRun) {
      results.push({ enrollmentId: en.id, season, seasonYear: occ.seasonYear, action: "would_charge", amountCents });
      continue;
    }

    // CLAIM FIRST — the UNIQUE(enrollment_id, season_year) insert is the idempotency
    // guard. A conflict (23505) means this season-year was already handled → skip.
    const { data: claim, error: claimErr } = await db
      .from("season_charges")
      .insert({
        enrollment_id: en.id,
        season_key: season,
        season_year: occ.seasonYear,
        season_start: iso(occ.seasonStart),
        charge_date: iso(occ.chargeDate),
        status: "pending",
        quantity,
        amount_cents: amountCents,
      })
      .select("id")
      .maybeSingle();
    if (claimErr) {
      if ((claimErr as { code?: string }).code === "23505") {
        results.push({ enrollmentId: en.id, season, seasonYear: occ.seasonYear, action: "already_charged_skip" });
        continue;
      }
      throw new Error(`season_charges claim failed: ${claimErr.message}`);
    }

    // Charge off-session on the saved card. idempotencyKey is deterministic per
    // (enrollment, season_year) — a second, independent backstop against double-charge.
    let paymentIntentId: string | null = null;
    let status: "succeeded" | "failed" = "succeeded";
    let chargeError: string | null = null;
    try {
      const pi = await stripe.paymentIntents.create(
        {
          amount: amountCents,
          currency: "usd",
          customer: en.stripe_customer_id,
          payment_method: en.stripe_payment_method_id ?? undefined,
          off_session: true,
          confirm: true,
          metadata: {
            product: "season_addon",
            season_key: season,
            season_year: String(occ.seasonYear),
            enrollment_id: en.id,
          },
        },
        { idempotencyKey: `igy_season_${en.id}_${occ.seasonYear}` },
      );
      paymentIntentId = pi.id;
      if (pi.status !== "succeeded") {
        status = "failed";
        chargeError = `pi_status_${pi.status}`;
      }
    } catch (e) {
      const err = e as Stripe.errors.StripeError;
      status = "failed";
      chargeError = err?.message ?? err?.code ?? "charge_error";
      paymentIntentId = (err?.payment_intent?.id as string | undefined) ?? null;
    }

    await db
      .from("season_charges")
      .update({ status, stripe_payment_intent_id: paymentIntentId, attempted_at: new Date().toISOString(), error: chargeError })
      .eq("id", claim!.id);

    results.push({
      enrollmentId: en.id,
      season,
      seasonYear: occ.seasonYear,
      action: status === "succeeded" ? "charged" : "charge_failed",
      amountCents,
      paymentIntentId,
      error: chargeError,
    });
  }

  return results;
}
