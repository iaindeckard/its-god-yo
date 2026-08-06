// Manual, on-demand IGY revenue calculator. NOT a scheduled job (matches USN's
// dei-financial/scripts/compute_revenue.py convention — a script Iain runs).
//
// Aggregates public.subscription_payments (the row-level Stripe ledger) for a
// calendar month into public.igy_monthly_financials, which the DEI holding-co ETL
// then mirrors. Produces, for the period:
//   * gross_revenue_cents      — sum of settled (gross) charge amounts, livemode only
//   * subscription_gross_cents } split of that gross into base-subscription vs the
//   * addon_gross_cents        } DM-from-Him add-on, via REAL Stripe invoice line
//                                items (not a fixed-price subtraction — stays correct
//                                automatically if pricing changes)
//   * mrr_cents / arr_cents    — NET basis (settled_net_cents: post-fees, post-refunds,
//                                post-chargebacks — the SAME "net" the cause-promotion
//                                tracking and reconcile ledger use), cadence-normalised
//                                to a monthly run-rate (monthly full, annual ÷12), then
//                                ARR = MRR×12 ("recurring subscription-backed net × 12")
//   * dei_licensing_fee_cents  — 40% of gross_revenue_cents (the standing DEI licensing
//                                model, same basis/shape as USN's compute_revenue.py;
//                                DEI-Licensing-Fee-Correction-LOCKED-2026-08-06)
//   * active_subscribers       — distinct subscriptions charged in the period
//
// CRITICAL: only livemode=true rows are revenue. The table carries Stripe's own
// livemode flag (IGY migration 20260806000001) precisely so test-clock artifacts can
// never count. Default aggregates livemode=true. --test-livemode aggregates the
// livemode=FALSE rows instead (validation dry-run only; refuses to --commit) so the
// math can be checked against the Aug-2/3 test-clock data before real revenue exists.
//
// Usage (loads env like the other scripts — e.g. `set -a; . ./.env.local; set +a`):
//   node scripts/compute-igy-revenue.mjs --period 2026-08                 # preview only
//   node scripts/compute-igy-revenue.mjs --period 2026-08 --commit        # preview, confirm, write
//   node scripts/compute-igy-revenue.mjs --period 2026-08 --test-livemode # dry-run vs test-clock rows
//
// Env required: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY,
// and the DM add-on price ids (NEXT_PUBLIC_PRICE_DM_ADDON_MONTHLY / _ANNUAL). The Stripe
// key MUST match the mode of the rows being read (a live key for livemode=true; the
// prod-account TEST key for --test-livemode against the test-clock rows).

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { createInterface } from "node:readline";

const DEI_FEE_RATE = 0.40;
const BUSINESS_UNIT_SLUG = "igy";
const MONTHS_PER_YEAR = 12;
const STRIPE_API_VERSION = "2025-02-24.acacia"; // pinned, matches lib/stripe.ts

// ── args ──
const argv = process.argv.slice(2);
const getArg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const period = getArg("--period");
const doCommit = argv.includes("--commit");
const testLivemode = argv.includes("--test-livemode");
if (!period || !/^\d{4}-\d{2}$/.test(period)) {
  console.error("ERROR: --period YYYY-MM is required (e.g. --period 2026-08).");
  process.exit(1);
}
if (testLivemode && doCommit) {
  console.error("REFUSING: --test-livemode is a validation dry-run and cannot be combined with --commit.");
  process.exit(1);
}
const targetLivemode = !testLivemode; // default: real (livemode=true); test: livemode=false rows

// ── period bounds (UTC, half-open [start, endExcl)) ──
const [year, month] = period.split("-").map(Number);
const start = new Date(Date.UTC(year, month - 1, 1));
const endExcl = new Date(Date.UTC(year, month, 1)); // first day of next month
const startIso = start.toISOString();
const endIso = endExcl.toISOString();

// ── clients ──
const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://bkwtlfkhfbfyzgnozixw.supabase.co";
const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supaKey) { console.error("ERROR: SUPABASE_SERVICE_ROLE_KEY is not set."); process.exit(1); }
const supa = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

const stripeKey = process.env.STRIPE_SECRET_KEY;
if (!stripeKey) { console.error("ERROR: STRIPE_SECRET_KEY is not set (needed for the invoice line-item add-on split)."); process.exit(1); }
const stripe = new Stripe(stripeKey, { apiVersion: STRIPE_API_VERSION });

// ── DM-from-Him add-on identification. Match by price id (from env, the same catalog
// the app uses — so it tracks live/test/future price changes) AND, defensively, by the
// stable Stripe lookup_key prefix so an id rotation can't silently misattribute the
// add-on as base subscription. ──
const DM_PRICE_IDS = new Set(
  [
    process.env.NEXT_PUBLIC_PRICE_DM_ADDON_MONTHLY,
    process.env.NEXT_PUBLIC_PRICE_DM_ADDON_ANNUAL,
    // committed prod-account TEST fallbacks (lib/plans.ts) so a dry-run without those
    // env vars still recognises the add-on on test-clock invoices:
    "price_1TzmrJGZ9WDMHywotvlZCNIK",
    "price_1Tznd8GZ9WDMHywo5TGChJIJ",
  ].filter(Boolean),
);
const isDmAddonPrice = (price) => {
  if (!price) return false;
  if (price.id && DM_PRICE_IDS.has(price.id)) return true;
  if (typeof price.lookup_key === "string" && price.lookup_key.startsWith("igy_dm_addon")) return true;
  return false;
};

function fail(msg) { console.error(msg); process.exit(1); }

async function main() {
  console.log(`=== IGY revenue compute — ${period} (${startIso} .. ${endIso}, exclusive) ===`);
  console.log(`Mode: ${testLivemode ? "TEST-LIVEMODE DRY-RUN (aggregating livemode=FALSE test-clock rows; will NOT write)" : "REAL (livemode=true only)"}\n`);

  // Resolve IGY business unit (FK + unique key on igy_monthly_financials).
  const { data: bu, error: buErr } = await supa
    .from("business_units").select("id").eq("slug", BUSINESS_UNIT_SLUG).single();
  if (buErr || !bu) fail(`Could not resolve business_unit '${BUSINESS_UNIT_SLUG}': ${buErr?.message ?? "missing"}`);
  const businessUnitId = bu.id;

  // Row-level ledger for the period. stripe_created_at = when money actually moved
  // (the balance-transaction time) — the revenue-recognition timestamp.
  const { data: rows, error: rowsErr } = await supa
    .from("subscription_payments")
    .select("id, kind, billing_reason, stripe_invoice_id, stripe_subscription_id, settled_amount_cents, settled_net_cents, settled_currency")
    .eq("business_unit", BUSINESS_UNIT_SLUG)
    .eq("livemode", targetLivemode)
    .gte("stripe_created_at", startIso)
    .lt("stripe_created_at", endIso);
  if (rowsErr) fail(`Failed to read subscription_payments: ${rowsErr.message}`);

  if (!rows || rows.length === 0) {
    console.log(`No subscription_payments rows for ${period} at livemode=${targetLivemode}.`);
    console.log(testLivemode
      ? "  (No test-clock rows in this window.)"
      : "  → Nothing to write. igy_monthly_financials correctly stays EMPTY for this period (no live revenue yet).");
    return;
  }

  // pending_signups plan_key map — cadence fallback when a Stripe invoice line lacks a
  // recurring interval (e.g. refund/dispute rows that have no invoice). individual_monthly
  // => monthly, everything else annual (same rule as v_cause_promotion_members).
  const subIds = [...new Set(rows.map((r) => r.stripe_subscription_id).filter(Boolean))];
  const planKeyBySub = new Map();
  if (subIds.length) {
    const { data: ps, error: psErr } = await supa
      .from("pending_signups").select("stripe_subscription_id, plan_key")
      .in("stripe_subscription_id", subIds);
    if (psErr) fail(`Failed to read pending_signups: ${psErr.message}`);
    for (const r of ps ?? []) planKeyBySub.set(r.stripe_subscription_id, r.plan_key);
  }
  const planKeyInterval = (sub) =>
    planKeyBySub.get(sub) === "individual_monthly" ? "month"
      : planKeyBySub.has(sub) ? "year" : null;

  // ── Pass 1: charges → gross + add-on split via real invoice line items; cache the
  // subscription's billing interval (authoritative, straight from the price). ──
  const invoiceCache = new Map();
  const intervalBySub = new Map();
  let grossRevenue = 0, subscriptionGross = 0, addonGross = 0;
  const activeSubs = new Set();
  const perInvoice = [];

  for (const r of rows) {
    if (r.kind !== "charge") continue;
    const gross = Number(r.settled_amount_cents ?? 0);
    grossRevenue += gross;
    if (r.stripe_subscription_id) activeSubs.add(r.stripe_subscription_id);

    let inv = null;
    if (r.stripe_invoice_id) {
      inv = invoiceCache.get(r.stripe_invoice_id);
      if (inv === undefined || inv === null) {
        inv = await stripe.invoices.retrieve(r.stripe_invoice_id, { expand: ["lines.data.price"] });
        invoiceCache.set(r.stripe_invoice_id, inv);
      }
    }
    if (!inv) {
      fail(`Charge ${r.id} has no retrievable invoice (stripe_invoice_id=${r.stripe_invoice_id}); ` +
           `cannot split add-on from a real line item. Aborting rather than guessing.`);
    }

    let lineTotal = 0, dmLineTotal = 0, baseInterval = null, addonInterval = null;
    for (const l of inv.lines.data) {
      const amt = Number(l.amount ?? 0);
      lineTotal += amt;
      const interval = l.price?.recurring?.interval ?? null; // 'month' | 'year'
      if (isDmAddonPrice(l.price)) {
        dmLineTotal += amt;
        if (interval) addonInterval = interval;
      } else if (interval) {
        baseInterval = interval;
      }
    }
    // Proportional allocation keeps subscription_gross + addon_gross === gross exactly,
    // and is currency-safe (splits the SETTLED amount by the invoice's own line ratio).
    const addonShare = lineTotal > 0 ? dmLineTotal / lineTotal : 0;
    const rowAddon = Math.round(gross * addonShare);
    addonGross += rowAddon;
    subscriptionGross += gross - rowAddon;

    if (r.stripe_subscription_id) {
      const interval = baseInterval ?? addonInterval ?? intervalBySub.get(r.stripe_subscription_id) ?? null;
      if (interval) intervalBySub.set(r.stripe_subscription_id, interval);
    }
    perInvoice.push({ id: r.stripe_invoice_id, sub: r.stripe_subscription_id, reason: r.billing_reason,
      gross, addon: rowAddon, base: gross - rowAddon, interval: baseInterval ?? addonInterval });
  }

  // ── Pass 2: MRR/ARR on NET basis, cadence-normalised over ALL rows (charges +,
  // refunds/disputes -). Interval from the Stripe cache, else plan_key, else monthly. ──
  let mrrFloat = 0;
  const unresolvedInterval = new Set();
  for (const r of rows) {
    const net = Number(r.settled_net_cents ?? 0);
    let interval = intervalBySub.get(r.stripe_subscription_id) ?? planKeyInterval(r.stripe_subscription_id);
    if (!interval) { interval = "month"; if (r.stripe_subscription_id) unresolvedInterval.add(r.stripe_subscription_id); }
    mrrFloat += interval === "year" ? net / MONTHS_PER_YEAR : net;
  }
  const mrr = Math.round(mrrFloat);
  const arr = mrr * MONTHS_PER_YEAR;

  const gross = grossRevenue;
  const fee = Math.round(gross * DEI_FEE_RATE);
  // Guarantee the identity even against any rounding: fold the 1-cent residual into base.
  const addonFinal = addonGross;
  const subFinal = gross - addonFinal;

  // ── report ──
  console.log(`Rows: ${rows.length}  (charges=${rows.filter((r) => r.kind === "charge").length}, ` +
    `refunds=${rows.filter((r) => r.kind === "refund").length}, disputes=${rows.filter((r) => r.kind === "dispute").length})`);
  console.log(`Distinct subscriptions charged (active_subscribers): ${activeSubs.size}\n`);
  console.log("--- gross & add-on split (from real Stripe invoice line items) ---");
  console.log(`  subscription_gross_cents : ${subFinal.toString().padStart(10)}  ($${(subFinal / 100).toFixed(2)})`);
  console.log(`  addon_gross_cents        : ${addonFinal.toString().padStart(10)}  ($${(addonFinal / 100).toFixed(2)})`);
  console.log(`  gross_revenue_cents      : ${gross.toString().padStart(10)}  ($${(gross / 100).toFixed(2)})`);
  console.log(`  (identity check sub+addon == gross: ${subFinal + addonFinal === gross ? "OK" : "MISMATCH!"})\n`);
  console.log("--- DEI licensing fee (40% of gross, LOCKED 2026-08-06) ---");
  console.log(`  dei_fee_rate             : ${DEI_FEE_RATE}`);
  console.log(`  dei_licensing_fee_cents  : ${fee.toString().padStart(10)}  ($${(fee / 100).toFixed(2)})\n`);
  console.log("--- recurring (NET basis: settled_net_cents, cadence-normalised) ---");
  console.log(`  mrr_cents                : ${mrr.toString().padStart(10)}  ($${(mrr / 100).toFixed(2)}/mo)`);
  console.log(`  arr_cents                : ${arr.toString().padStart(10)}  ($${(arr / 100).toFixed(2)}/yr)`);
  if (unresolvedInterval.size) {
    console.log(`  WARNING: ${unresolvedInterval.size} subscription(s) had no cadence signal (no Stripe interval, no plan_key); treated as MONTHLY. Subs: ${[...unresolvedInterval].join(", ")}`);
  }
  console.log();
  console.log("--- per-invoice detail ---");
  for (const p of perInvoice) {
    console.log(`  ${p.reason?.padEnd(20) ?? "?".padEnd(20)} ${p.interval ?? "?"}  gross=$${(p.gross / 100).toFixed(2)}  base=$${(p.base / 100).toFixed(2)}  addon=$${(p.addon / 100).toFixed(2)}  sub=${p.sub}`);
  }
  console.log();

  if (!doCommit) {
    console.log(testLivemode
      ? "TEST-LIVEMODE dry-run — nothing written (and cannot be). This validates the math only."
      : "Preview only — nothing written. Re-run with --commit to upsert igy_monthly_financials.");
    return;
  }

  // ── commit guards (mirrors compute_revenue.py: idempotent upsert, typed confirm) ──
  const row = {
    business_unit_id: businessUnitId,
    period_year: year,
    period_month: month,
    subscription_gross_cents: subFinal,
    addon_gross_cents: addonFinal,
    gross_revenue_cents: gross,
    mrr_cents: mrr,
    arr_cents: arr,
    active_subscribers: activeSubs.size,
    dei_fee_rate: DEI_FEE_RATE,
    dei_licensing_fee_cents: fee,
    source: "compute-igy-revenue.mjs",
    computed_at: new Date().toISOString(),
  };
  const todayUtc = new Date();
  if (endExcl > todayUtc) {
    console.log(`NOTE: ${period} has not closed yet (ends ${endIso}). This is a PARTIAL running total — more`);
    console.log("      charges can still land before month-end. Re-run after the period closes for a final figure.\n");
  }
  console.log(`About to UPSERT igy_monthly_financials for business_unit_id=${businessUnitId}, ${year}-${String(month).padStart(2, "0")}:`);
  console.log(`  gross=${gross}  sub=${subFinal}  addon=${addonFinal}  fee=${fee}  mrr=${mrr}  arr=${arr}  subs=${activeSubs.size}`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((res) => rl.question(`Type the period again (${period}) to confirm and write: `, res));
  rl.close();
  if (answer.trim() !== period) { console.log("Confirmation did not match — nothing written."); process.exit(1); }

  const { data: written, error: upErr } = await supa
    .from("igy_monthly_financials")
    .upsert(row, { onConflict: "business_unit_id,period_year,period_month" })
    .select("period_year, period_month, gross_revenue_cents, subscription_gross_cents, addon_gross_cents, dei_licensing_fee_cents, mrr_cents, arr_cents, active_subscribers");
  if (upErr) fail(`Upsert failed: ${upErr.message}`);
  console.log("\nWritten to igy_monthly_financials:");
  console.log(JSON.stringify(written?.[0] ?? written, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
