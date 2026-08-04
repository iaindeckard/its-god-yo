import "server-only";
import { getSupabaseAdmin } from "./supabaseAdmin";

/**
 * Tithe / Donation Fund engine (spec: IGY-Tithe-Donation-Fund-Ledger-SPEC-v2).
 *
 * Daily close-of-business: compute the day's real net profit from EXACT inputs —
 * Stripe fees (per-transaction), a precise daily share of known flat recurring
 * costs (amount / days in the period), real Twilio usage (summed from the send
 * log) — plus any one-time/irregular costs booked on that day. 10% of a POSITIVE
 * net is added to the reserved fund; loss days add $0 and never subtract. The
 * reserve is a LEDGER only (no physical movement). Manual disbursements decrement
 * the available balance (available = accrued tithe − disbursed).
 */

const TITHE_RATE = 0.1;
const BUSINESS_UNIT_SLUG = "igy";
const TZ = "America/Chicago"; // Wichita, KS — close of business is a local day

// ─── date helpers (local-day boundaries, exact day counts) ───────────────────

function tzOffsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(instant)) p[part.type] = part.value;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour === 24 ? 0 : +p.hour, +p.minute, +p.second);
  return asUTC - instant.getTime();
}

/** UTC unix-second bounds [start, end) of the given YYYY-MM-DD in America/Chicago. */
export function localDayBoundsUnix(dateStr: string): { startUnix: number; endUnix: number } {
  const [y, m, d] = dateStr.split("-").map(Number);
  const utcMidnight = Date.UTC(y, m - 1, d, 0, 0, 0);
  const offset = tzOffsetMs(new Date(utcMidnight), TZ);
  const startMs = utcMidnight - offset; // UTC instant whose Chicago wall-clock is this date 00:00
  return { startUnix: Math.floor(startMs / 1000), endUnix: Math.floor(startMs / 1000) + 86400 };
}

/** YYYY-MM-DD for "today"/"yesterday" as seen in America/Chicago. */
export function localDateStr(offsetDays = 0): string {
  const now = new Date(Date.now() + offsetDays * 86400000);
  const dtf = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  return dtf.format(now); // en-CA => YYYY-MM-DD
}

function daysInMonth(dateStr: string): number {
  const [y, m] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function daysInYear(dateStr: string): number {
  const y = Number(dateStr.split("-")[0]);
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365;
}

// ─── business unit ───────────────────────────────────────────────────────────

async function getBusinessUnitId(): Promise<string> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from("business_units").select("id").eq("slug", BUSINESS_UNIT_SLUG).single();
  if (error || !data) throw new Error(`business_unit '${BUSINESS_UNIT_SLUG}' not found: ${error?.message ?? "missing"}`);
  return data.id as string;
}

// ─── per-category daily cost inputs ──────────────────────────────────────────

export interface StripeDay {
  grossRevenueCents: number;
  feesCents: number;
  txnCount: number;
  error: string | null;
}

/**
 * Real IGY subscription revenue + fees for the local day. CHANGED 2026-08-04:
 * sourced from subscription_payments (THIS business unit, settled 'paid') — NOT
 * account-wide Stripe balance transactions, which counted test-clock and non-IGY
 * activity and inflated the fund with phantom revenue. Refunds are not netted here
 * (rare; a later refinement). NOTE: subscription_payments is rebuilt from Stripe by
 * the reconcile cron, so historical test-clock rows can still linger — but the daily
 * close only reads its own day, so once real charges begin this reflects real income.
 */
export async function stripeDay(dateStr: string): Promise<StripeDay> {
  const { startUnix, endUnix } = localDayBoundsUnix(dateStr);
  try {
    const admin = getSupabaseAdmin();
    const startIso = new Date(startUnix * 1000).toISOString();
    const endIso = new Date(endUnix * 1000).toISOString();
    const { data, error } = await admin
      .from("subscription_payments")
      .select("settled_amount_cents, settled_fee_cents")
      .eq("business_unit", BUSINESS_UNIT_SLUG)
      .eq("status", "paid")
      .gte("stripe_created_at", startIso)
      .lt("stripe_created_at", endIso);
    if (error) return { grossRevenueCents: 0, feesCents: 0, txnCount: 0, error: error.message };
    let gross = 0, fees = 0;
    for (const r of (data ?? []) as Array<{ settled_amount_cents: number | null; settled_fee_cents: number | null }>) {
      gross += Number(r.settled_amount_cents ?? 0);
      fees += Number(r.settled_fee_cents ?? 0);
    }
    return { grossRevenueCents: gross, feesCents: fees, txnCount: (data ?? []).length, error: null };
  } catch (e) {
    return { grossRevenueCents: 0, feesCents: 0, txnCount: 0, error: e instanceof Error ? e.message : "query_error" };
  }
}

export interface RecurringCost {
  vendor: string;
  description: string | null;
  amount_cents: number;
  cadence: "monthly" | "annual";
  source: string;
  dailyShareCents: number;
}

/** Active recurring costs on `dateStr`, each with its exact daily share. */
export async function recurringCostsForDay(dateStr: string): Promise<RecurringCost[]> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("igy_recurring_costs")
    .select("vendor, description, amount_cents, cadence, source, effective_start, effective_end")
    .eq("active", true)
    .lte("effective_start", dateStr);
  if (error) throw new Error(`recurring_costs_query_failed: ${error.message}`);
  const perMonth = daysInMonth(dateStr);
  const perYear = daysInYear(dateStr);
  return (data ?? [])
    .filter((r) => !r.effective_end || r.effective_end >= dateStr)
    .map((r) => {
      const days = r.cadence === "annual" ? perYear : perMonth;
      return {
        vendor: r.vendor,
        description: r.description,
        amount_cents: r.amount_cents,
        cadence: r.cadence,
        source: r.source,
        dailyShareCents: Math.round(r.amount_cents / days),
      };
    });
}

async function sumColumnForDay(table: string, dateCol: string, sumCol: string, dateStr: string): Promise<number> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from(table).select(sumCol).eq(dateCol, dateStr);
  if (error) throw new Error(`${table}_query_failed: ${error.message}`);
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  return rows.reduce((s, row) => s + Number(row[sumCol] ?? 0), 0);
}

async function priorAccruedCents(businessUnitId: string, dateStr: string): Promise<number> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("igy_donation_fund_ledger")
    .select("tithe_cents")
    .eq("business_unit_id", businessUnitId)
    .lt("entry_date", dateStr);
  if (error) throw new Error(`ledger_prior_query_failed: ${error.message}`);
  return (data ?? []).reduce((s, r) => s + Number(r.tithe_cents ?? 0), 0);
}

// ─── daily close ─────────────────────────────────────────────────────────────

export interface DailyClose {
  entry_date: string;
  gross_revenue_cents: number;
  stripe_fees_cents: number;
  recurring_costs_cents: number;
  twilio_cost_cents: number;
  one_time_costs_cents: number;
  net_profit_cents: number;
  tithe_cents: number;
  reserved_balance_after_cents: number;
  recurring_breakdown: RecurringCost[];
  stripe_error: string | null;
  is_loss_day: boolean;
}

/**
 * Compute (and persist, idempotently) the donation-fund close for one local day.
 * Re-running the same date recomputes and upserts that row.
 */
export async function computeDailyClose(dateStr: string): Promise<DailyClose> {
  const admin = getSupabaseAdmin();
  const businessUnitId = await getBusinessUnitId();

  const [stripe, recurring, twilioCost, oneTimeCost, priorAccrued] = await Promise.all([
    stripeDay(dateStr),
    recurringCostsForDay(dateStr),
    sumColumnForDay("igy_sms_log", "sent_on", "cost_cents", dateStr),
    sumColumnForDay("igy_one_time_costs", "incurred_on", "amount_cents", dateStr),
    priorAccruedCents(businessUnitId, dateStr),
  ]);

  const recurringCents = recurring.reduce((s, r) => s + r.dailyShareCents, 0);
  const twilioCents = Math.round(twilioCost);
  const oneTimeCents = Math.round(oneTimeCost);

  const netProfit =
    stripe.grossRevenueCents - stripe.feesCents - recurringCents - twilioCents - oneTimeCents;
  const tithe = netProfit > 0 ? Math.round(netProfit * TITHE_RATE) : 0;
  const reservedAfter = priorAccrued + tithe;

  const row = {
    business_unit_id: businessUnitId,
    entry_date: dateStr,
    gross_revenue_cents: stripe.grossRevenueCents,
    stripe_fees_cents: stripe.feesCents,
    recurring_costs_cents: recurringCents,
    twilio_cost_cents: twilioCents,
    one_time_costs_cents: oneTimeCents,
    net_profit_cents: netProfit,
    tithe_rate: TITHE_RATE,
    tithe_cents: tithe,
    reserved_balance_after_cents: reservedAfter,
    entry_type: "daily_close",
    source: stripe.error ? "computed_stripe_unavailable" : "computed",
    computed_at: new Date().toISOString(),
    notes: stripe.error ? `stripe query failed: ${stripe.error}` : null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin
    .from("igy_donation_fund_ledger")
    .upsert(row, { onConflict: "business_unit_id,entry_date" });
  if (error) throw new Error(`ledger_upsert_failed: ${error.message}`);

  return {
    entry_date: dateStr,
    gross_revenue_cents: stripe.grossRevenueCents,
    stripe_fees_cents: stripe.feesCents,
    recurring_costs_cents: recurringCents,
    twilio_cost_cents: twilioCents,
    one_time_costs_cents: oneTimeCents,
    net_profit_cents: netProfit,
    tithe_cents: tithe,
    reserved_balance_after_cents: reservedAfter,
    recurring_breakdown: recurring,
    stripe_error: stripe.error,
    is_loss_day: netProfit <= 0,
  };
}

// ─── fund summary + disbursements ────────────────────────────────────────────

export interface LedgerRow {
  entry_date: string;
  gross_revenue_cents: number;
  stripe_fees_cents: number;
  recurring_costs_cents: number;
  twilio_cost_cents: number;
  one_time_costs_cents: number;
  net_profit_cents: number;
  tithe_cents: number;
}
export interface DisbursementRow {
  id: string;
  disbursed_on: string;
  charity_name: string;
  amount_cents: number;
  reference: string | null;
  notes: string | null;
}
export interface FundSummary {
  accruedCents: number; // total tithe ever added
  disbursedCents: number; // total donated out
  availableCents: number; // reserved and still un-donated
  lastCloseDate: string | null;
  recentLedger: LedgerRow[];
  recentDisbursements: DisbursementRow[];
  recurringCosts: RecurringCost[];
}

export async function getFundSummary(dateForCosts?: string): Promise<FundSummary> {
  const admin = getSupabaseAdmin();
  const businessUnitId = await getBusinessUnitId();

  const [ledgerRes, disbRes, recurring] = await Promise.all([
    admin
      .from("igy_donation_fund_ledger")
      .select(
        "entry_date, gross_revenue_cents, stripe_fees_cents, recurring_costs_cents, twilio_cost_cents, one_time_costs_cents, net_profit_cents, tithe_cents",
      )
      .eq("business_unit_id", businessUnitId)
      .order("entry_date", { ascending: false })
      .limit(30),
    admin
      .from("igy_donation_disbursements")
      .select("id, disbursed_on, charity_name, amount_cents, reference, notes")
      .eq("business_unit_id", businessUnitId)
      .order("disbursed_on", { ascending: false })
      .limit(30),
    recurringCostsForDay(dateForCosts ?? localDateStr(0)),
  ]);
  if (ledgerRes.error) throw new Error(`ledger_query_failed: ${ledgerRes.error.message}`);
  if (disbRes.error) throw new Error(`disbursements_query_failed: ${disbRes.error.message}`);

  // Authoritative totals across ALL rows (not just the 30 shown above).
  const accrued = await sumAll(admin, "igy_donation_fund_ledger", "tithe_cents", businessUnitId);
  const disbursed = await sumAll(admin, "igy_donation_disbursements", "amount_cents", businessUnitId);

  const recentLedger = (ledgerRes.data ?? []) as LedgerRow[];
  return {
    accruedCents: accrued,
    disbursedCents: disbursed,
    availableCents: accrued - disbursed,
    lastCloseDate: recentLedger[0]?.entry_date ?? null,
    recentLedger,
    recentDisbursements: (disbRes.data ?? []) as DisbursementRow[],
    recurringCosts: recurring,
  };
}

async function sumAll(
  admin: ReturnType<typeof getSupabaseAdmin>,
  table: string,
  col: string,
  businessUnitId: string,
): Promise<number> {
  const { data, error } = await admin.from(table).select(col).eq("business_unit_id", businessUnitId);
  if (error) throw new Error(`${table}_sum_failed: ${error.message}`);
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  return rows.reduce((s, r) => s + Number(r[col] ?? 0), 0);
}

export interface RecordDisbursementInput {
  charityName: string;
  amountCents: number;
  disbursedOn?: string;
  reference?: string;
  triggeredBy?: string;
  notes?: string;
}

/** Record a manual donation. Refuses to exceed the available reserved balance. */
export async function recordDisbursement(input: RecordDisbursementInput): Promise<FundSummary> {
  const admin = getSupabaseAdmin();
  const businessUnitId = await getBusinessUnitId();
  if (!input.charityName?.trim()) throw new Error("charity_name is required");
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new Error("amount must be a positive integer (cents)");

  const summary = await getFundSummary();
  if (input.amountCents > summary.availableCents) {
    throw new Error(
      `amount ($${(input.amountCents / 100).toFixed(2)}) exceeds available reserved balance ($${(summary.availableCents / 100).toFixed(2)})`,
    );
  }

  const { error } = await admin.from("igy_donation_disbursements").insert({
    business_unit_id: businessUnitId,
    disbursed_on: input.disbursedOn || localDateStr(0),
    charity_name: input.charityName.trim(),
    amount_cents: input.amountCents,
    reference: input.reference?.trim() || null,
    triggered_by: input.triggeredBy || null,
    notes: input.notes?.trim() || null,
  });
  if (error) throw new Error(`disbursement_insert_failed: ${error.message}`);
  return getFundSummary();
}
