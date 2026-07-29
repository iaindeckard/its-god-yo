import "server-only";
import type Stripe from "stripe";
import { getSupabaseAdmin } from "./supabaseAdmin";
import { getStripe } from "./stripe";
import { subscriptionMonthlyValueCents } from "./referral";
import type { Staff } from "./rbac";
import { earnedEmail, notFirstEmail, rejectedEmail, cappedEmail, snagEmail, sendBountyEmail } from "./bountyEmails";

/**
 * Translation/reword error bounty — v2 (spec IGY-Translation-Error-Bounty-Spec-
 * 2026-07-29-v2.md), pass 1: reward engine + intake.
 *
 * A confirmed error rewards the EARLIEST reporter with a **Stripe customer-
 * balance credit equal to 1/12 of their actual annual price** — computed per
 * customer from their live subscription, in their own currency, reusing the SAME
 * mechanism as referral.ts (subscriptionMonthlyValueCents + a customer balance
 * transaction that auto-reduces their next invoice). No flat amount, no manual
 * redemption step — the credit lands on whatever invoice comes next.
 *
 * Guardrails:
 *   - Intake requires an email that matches a real account on file (§6), and is
 *     rate-limited to 1 report/account/day (§5).
 *   - The reward is capped at 6 months' worth of credit per account per CALENDAR
 *     year (§4), enforced at issuance as a cents-sum ceiling (partial-caps the
 *     last credit; never a silent reject).
 *   - Human confirmation over grouped reports remains the anti-gaming gate; only
 *     the earliest-timestamped reporter of a confirmed group is rewarded.
 *
 * NOTE (pass 2): AI assessment, publishing the fix to live daily_slots content,
 * and binding confirmations into review_sessions/corrections_log are deferred to
 * pass 2 — a corrections_log entry only makes sense once a fix is actually
 * published. Pass 1 records reviewer attribution on igy_error_reports directly.
 */

/** Annual reward ceiling, in months-of-credit, per account per calendar year. */
export const ANNUAL_CAP_MONTHS = 6;

/** Deterministic grouping key: reports on the same verse/date/track cluster. */
export function groupKey(themeTrack: string, reportDate: string, verseRef: string): string {
  return `${themeTrack}|${reportDate}|${verseRef}`;
}

function firstOfMonthUTC(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}
function startOfDayUTC(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}T00:00:00.000Z`;
}
function calendarYearBoundsUTC(d = new Date()): { start: string; end: string } {
  const y = d.getUTCFullYear();
  return { start: `${y}-01-01`, end: `${y}-12-31` };
}
function isUniqueViolation(err: unknown): boolean {
  return !!err && (err as { code?: string }).code === "23505";
}

// ─── Stripe resolution (identity + credit value) ─────────────────────────────

/** The monthly-equivalent value (cents) + currency of a customer's active plan,
 *  or null if they have no active/trialing subscription to credit. This is what
 *  "one month" is worth for this specific customer. */
async function activePlanValueFor(
  stripe: Stripe,
  customerId: string,
): Promise<{ monthlyCents: number; currency: string } | null> {
  const res = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 10 });
  const sub = res.data.find((s) => s.status === "active" || s.status === "trialing");
  if (!sub) return null;
  const monthlyCents = subscriptionMonthlyValueCents(sub);
  if (monthlyCents <= 0) return null;
  return { monthlyCents, currency: sub.currency || "usd" };
}

/** Identity match (§6): find the Stripe customer for a reporter email. Returns
 *  the customer id (preferring one with an active subscription), or null if no
 *  account is on file for that email. */
async function matchCustomerByEmail(email: string): Promise<string | null> {
  const stripe = getStripe();
  const res = await stripe.customers.list({ email, limit: 100 });
  if (res.data.length === 0) return null;
  for (const c of res.data) {
    const subs = await stripe.subscriptions.list({ customer: c.id, status: "all", limit: 1 });
    if (subs.data.some((s) => s.status === "active" || s.status === "trialing")) return c.id;
  }
  return res.data[0].id; // account exists but no active sub — still a match for identity
}

// ─── reporting (public) ──────────────────────────────────────────────────────

export interface SubmitReportInput {
  reporterEmail: string;
  verseRef: string;
  themeTrack?: string;
  reportDate: string; // YYYY-MM-DD
  reportedText?: string;
  description: string;
}

export interface ReportRow {
  id: string;
  reporter_email: string;
  verse_ref: string;
  theme_track: string;
  report_date: string;
  reported_text: string | null;
  description: string;
  group_key: string;
  submitted_at: string;
  status: string;
}

export async function submitReport(input: SubmitReportInput): Promise<ReportRow> {
  const admin = getSupabaseAdmin();
  if (!input.reporterEmail?.trim()) throw new Error("reporter email is required");
  if (!input.verseRef?.trim()) throw new Error("verse reference is required");
  if (!input.reportDate?.trim()) throw new Error("report date is required");
  if (!input.description?.trim()) throw new Error("a description of the issue is required");
  const email = input.reporterEmail.trim().toLowerCase();
  const track = input.themeTrack?.trim() || "general";

  // §6 identity match — must be an account on file. We resolve server-side from
  // the email; customers were never issued an internal id and shouldn't need one.
  const customerId = await matchCustomerByEmail(email);
  if (!customerId) {
    throw new Error(
      "We couldn't find an It's God, Yo! account for that email. Please use the email address on your subscription.",
    );
  }

  // §5 rate limit — 1 report per account per day (UTC).
  const { count, error: rlErr } = await admin
    .from("igy_error_reports")
    .select("id", { count: "exact", head: true })
    .eq("reporter_email", email)
    .gte("submitted_at", startOfDayUTC());
  if (rlErr) throw new Error(`rate_limit_check_failed: ${rlErr.message}`);
  if ((count ?? 0) >= 1) {
    throw new Error("You've already submitted a report today — thank you! Please come back tomorrow with any others.");
  }

  const { data, error } = await admin
    .from("igy_error_reports")
    .insert({
      reporter_email: email,
      reporter_stripe_customer_id: customerId,
      verse_ref: input.verseRef.trim(),
      theme_track: track,
      report_date: input.reportDate,
      reported_text: input.reportedText?.trim() || null,
      description: input.description.trim(),
      group_key: groupKey(track, input.reportDate, input.verseRef.trim()),
    })
    .select("id, reporter_email, verse_ref, theme_track, report_date, reported_text, description, group_key, submitted_at, status")
    .single();
  if (error) throw new Error(`report_insert_failed: ${error.message}`);
  return data as ReportRow;
}

// ─── review queue (grouped, mirrors theme-tags) ──────────────────────────────

export interface ReviewGroup {
  group_key: string;
  verse_ref: string;
  theme_track: string;
  report_date: string;
  reports: ReportRow[]; // earliest first
  earliest_reporter_email: string;
  report_count: number;
}

export async function getReviewGroups(status = "pending"): Promise<ReviewGroup[]> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("igy_error_reports")
    .select("id, reporter_email, verse_ref, theme_track, report_date, reported_text, description, group_key, submitted_at, status")
    .eq("status", status)
    .order("group_key", { ascending: true })
    .order("submitted_at", { ascending: true });
  if (error) throw new Error(`review_groups_query_failed: ${error.message}`);

  const groups = new Map<string, ReviewGroup>();
  for (const r of (data ?? []) as ReportRow[]) {
    let g = groups.get(r.group_key);
    if (!g) {
      g = {
        group_key: r.group_key,
        verse_ref: r.verse_ref,
        theme_track: r.theme_track,
        report_date: r.report_date,
        reports: [],
        earliest_reporter_email: r.reporter_email, // first seen = earliest (ordered by submitted_at)
        report_count: 0,
      };
      groups.set(r.group_key, g);
    }
    g.reports.push(r);
    g.report_count++;
  }
  return [...groups.values()];
}

export interface ConfirmResult {
  group_key: string;
  decision: "confirm" | "reject";
  report_count: number;
  winner_email: string | null;
  credited: boolean;
  credit_cents: number | null;
  capped: boolean;
  skipped: boolean;
  skipped_reason: string | null;
  warning: string | null; // set when the credit was issued in Stripe but the ledger write degraded
}

interface GroupReportRow {
  id: string;
  reporter_email: string;
  reporter_stripe_customer_id: string | null;
  verse_ref: string;
  submitted_at: string;
}

/**
 * Confirm or reject a whole group. On confirm, ONLY the earliest-timestamped
 * reporter earns a credit — a Stripe balance credit = 1/12 of their annual price,
 * subject to the 6-months-per-calendar-year cap (partial-capping the final
 * credit). Every reporter in the group gets a warm outcome email (§10).
 */
export async function confirmGroup(gkey: string, decision: "confirm" | "reject", staff: Staff, note?: string): Promise<ConfirmResult> {
  const admin = getSupabaseAdmin();
  const { data: reportsData, error } = await admin
    .from("igy_error_reports")
    .select("id, reporter_email, reporter_stripe_customer_id, verse_ref, submitted_at")
    .eq("group_key", gkey)
    .eq("status", "pending")
    .order("submitted_at", { ascending: true });
  if (error) throw new Error(`group_read_failed: ${error.message}`);
  const reports = (reportsData ?? []) as GroupReportRow[];
  if (reports.length === 0) throw new Error("no pending reports in this group");
  const verseRef = reports[0].verse_ref;

  const newStatus = decision === "confirm" ? "confirmed" : "rejected";
  const { error: updErr } = await admin
    .from("igy_error_reports")
    .update({ status: newStatus, reviewed_by: staff.userId, reviewed_at: new Date().toISOString(), review_note: note?.trim() || null })
    .eq("group_key", gkey)
    .eq("status", "pending");
  if (updErr) throw new Error(`group_update_failed: ${updErr.message}`);

  // Rejected: warm "not an error" note to everyone, no reward.
  if (decision === "reject") {
    await notifyAll(reports.map((r) => r.reporter_email), () => rejectedEmail(verseRef));
    return { group_key: gkey, decision, report_count: reports.length, winner_email: null, credited: false, credit_cents: null, capped: false, skipped: false, skipped_reason: null, warning: null };
  }

  // Confirmed: earliest reporter is the winner; everyone else gets "not first".
  const winner = reports[0];
  const others = reports.slice(1).map((r) => r.reporter_email);
  const base = { group_key: gkey, decision, report_count: reports.length, winner_email: winner.reporter_email } as const;

  // Resolve the winner's plan value (their real subscription).
  const stripe = getStripe();
  const customerId = winner.reporter_stripe_customer_id ?? (await matchCustomerByEmail(winner.reporter_email));
  const plan = customerId ? await activePlanValueFor(stripe, customerId) : null;

  if (!customerId || !plan) {
    // Can't credit — no resolvable customer/active subscription. Record for
    // manual follow-up (never silent); still thank the others warmly.
    const reason = !customerId ? "no Stripe account matched the winner's email" : "winner has no active subscription to credit";
    await admin.from("igy_bounty_credits").insert({
      report_id: winner.id,
      reporter_email: winner.reporter_email,
      reporter_stripe_customer_id: customerId ?? null,
      amount_cents: 0,
      status: "skipped",
      skipped_reason: reason,
      issued_by: staff.userId,
      credit_month: firstOfMonthUTC(),
    });
    // Tell the winner directly — they earned it but we couldn't auto-apply it;
    // we'll follow up. (Without this, only the non-winners heard anything.)
    await sendBountyEmail(winner.reporter_email, snagEmail(verseRef));
    await notifyAll(others, () => notFirstEmail(verseRef));
    return { ...base, credited: false, credit_cents: null, capped: false, skipped: true, skipped_reason: reason, warning: null };
  }

  // §4 annual cap — cents-sum ceiling in the current calendar year.
  const { start, end } = calendarYearBoundsUTC();
  const { data: ytdRows, error: capErr } = await admin
    .from("igy_bounty_credits")
    .select("amount_cents")
    .eq("reporter_email", winner.reporter_email)
    .in("status", ["issued", "reconcile"]) // both represent money actually credited
    .gte("credit_month", start)
    .lte("credit_month", end);
  if (capErr) throw new Error(`cap_check_failed: ${capErr.message}`);
  const ytdCents = (ytdRows ?? []).reduce((s, r) => s + ((r as { amount_cents: number }).amount_cents || 0), 0);
  const ceilingCents = ANNUAL_CAP_MONTHS * plan.monthlyCents;
  const remaining = ceilingCents - ytdCents;

  if (remaining <= 0) {
    await sendBountyEmail(winner.reporter_email, cappedEmail(verseRef));
    await notifyAll(others, () => notFirstEmail(verseRef));
    return { ...base, credited: false, credit_cents: null, capped: true, skipped: false, skipped_reason: null, warning: null };
  }

  const creditCents = Math.min(plan.monthlyCents, remaining); // partial-cap the last credit

  // Apply the Stripe customer-balance credit (negative = credit toward next
  // invoice), idempotent per winning report.
  const txn = await stripe.customers.createBalanceTransaction(
    customerId,
    {
      amount: -creditCents,
      currency: plan.currency,
      description: `IGY error-bounty: confirmed report on ${verseRef}`,
      metadata: { bounty_report_id: winner.id, kind: "error_bounty" },
    },
    { idempotencyKey: `bounty_credit_${winner.id}` },
  );

  const creditRow = {
    report_id: winner.id,
    reporter_email: winner.reporter_email,
    reporter_stripe_customer_id: customerId,
    amount_cents: creditCents,
    stripe_balance_transaction_id: txn.id,
    issued_by: staff.userId,
    credit_month: firstOfMonthUTC(),
  };

  // Record the credit. The Stripe credit is already LIVE and idempotent, so we
  // must NOT strand it: retry once for a transient blip, and if the ledger still
  // won't accept it, persist a VISIBLE 'reconcile' row instead of a console.error
  // that vanishes (there is no Sentry/log-drain here). Only if even that fails do
  // we throw — loudly, with the txn id — so it can't disappear silently.
  const amountUsd = `$${(creditCents / 100).toFixed(2)}`;
  let warning: string | null = null;
  let ins = await admin.from("igy_bounty_credits").insert({ ...creditRow, status: "issued" });
  if (ins.error && !isUniqueViolation(ins.error)) {
    ins = await admin.from("igy_bounty_credits").insert({ ...creditRow, status: "issued" }); // one retry
  }
  if (ins.error && isUniqueViolation(ins.error)) {
    // A credit row for this report already exists (idempotent re-confirm; the
    // Stripe idempotency key means no double credit). Already recorded — fine.
  } else if (ins.error) {
    const reason = `Stripe credit ${txn.id} (${amountUsd}) issued but ledger insert failed: ${ins.error.message}`;
    const recon = await admin.from("igy_bounty_credits").insert({ ...creditRow, status: "reconcile", skipped_reason: reason });
    if (recon.error) {
      // Both writes failed — surface HARD so the admin sees it immediately and
      // can record it by hand. The credit is real; nothing double-charges.
      throw new Error(
        `credit_issued_but_unrecorded: Stripe balance txn ${txn.id} for ${amountUsd} to ${winner.reporter_email} succeeded, but the ledger could not be written (${ins.error.message}; reconcile insert: ${recon.error.message}). Record this credit manually.`,
      );
    }
    warning = `Credit ${amountUsd} was issued in Stripe (txn ${txn.id}) but the ledger write was degraded — it's logged as 'reconcile' for you to verify.`;
    console.error(`[bounty] ${warning}`);
  }

  await sendBountyEmail(winner.reporter_email, earnedEmail(verseRef, creditCents));
  await notifyAll(others, () => notFirstEmail(verseRef));

  return { ...base, credited: true, credit_cents: creditCents, capped: false, skipped: false, skipped_reason: null, warning };
}

/** Best-effort fan-out of the same email to many reporters (dedup'd). */
async function notifyAll(emails: string[], build: () => ReturnType<typeof rejectedEmail>): Promise<void> {
  const unique = [...new Set(emails.filter(Boolean))];
  await Promise.allSettled(unique.map((to) => sendBountyEmail(to, build())));
}

// ─── credit ledger (read-only) ───────────────────────────────────────────────

export interface CreditRow {
  id: string;
  reporter_email: string;
  reporter_stripe_customer_id: string | null;
  amount_cents: number;
  status: string; // issued | skipped | reconcile | reversed
  issued_at: string;
  credit_month: string;
  stripe_balance_transaction_id: string | null;
  skipped_reason: string | null;
  report_id: string;
}
export interface ReporterYearToDate {
  reporter_email: string;
  credited_count: number;
  ytd_cents: number;
}
export interface BountyLedger {
  issuedCents: number; // total credit that moved (status 'issued' + 'reconcile')
  issuedCount: number;
  skippedCount: number; // confirmed but no money moved (no customer/sub) — follow up
  reconcileCount: number; // money moved but ledger write degraded — verify in Stripe
  followUps: CreditRow[]; // every skipped + reconcile row, so none hide past the recent cap
  reporterYtd: ReporterYearToDate[]; // this calendar year, for cap visibility
  recentCredits: CreditRow[];
}

export async function getBountyLedger(): Promise<BountyLedger> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("igy_bounty_credits")
    .select("id, reporter_email, reporter_stripe_customer_id, amount_cents, status, issued_at, credit_month, stripe_balance_transaction_id, skipped_reason, report_id")
    .order("issued_at", { ascending: false });
  if (error) throw new Error(`bounty_ledger_query_failed: ${error.message}`);
  const rows = (data ?? []) as CreditRow[];
  const { start } = calendarYearBoundsUTC();

  let issuedCents = 0, issuedCount = 0, skippedCount = 0, reconcileCount = 0;
  const perReporter = new Map<string, ReporterYearToDate>();
  for (const c of rows) {
    const moved = c.status === "issued" || c.status === "reconcile"; // money actually credited
    if (moved) { issuedCents += c.amount_cents; issuedCount++; }
    if (c.status === "skipped") skippedCount++;
    if (c.status === "reconcile") reconcileCount++;
    if (moved && c.credit_month >= start) {
      const rb = perReporter.get(c.reporter_email) ?? { reporter_email: c.reporter_email, credited_count: 0, ytd_cents: 0 };
      rb.credited_count++;
      rb.ytd_cents += c.amount_cents;
      perReporter.set(c.reporter_email, rb);
    }
  }
  return {
    issuedCents,
    issuedCount,
    skippedCount,
    reconcileCount,
    followUps: rows.filter((c) => c.status === "skipped" || c.status === "reconcile"),
    reporterYtd: [...perReporter.values()].sort((a, b) => b.ytd_cents - a.ytd_cents),
    recentCredits: rows.slice(0, 40),
  };
}
