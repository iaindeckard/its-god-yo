import "server-only";
import { getSupabaseAdmin } from "./supabaseAdmin";
import type { Staff } from "./rbac";

/**
 * Translation/reword error bounty. A confirmed error EARNS the earliest reporter
 * a $6.99 internal credit — tracked in IGY's own ledger (igy_bounty_credits),
 * NOT Stripe. Applying a credit toward a bill is a deliberate MANUAL admin
 * action, exactly mirroring the donation fund's earn-then-manually-disburse
 * model. Confirmation is human review over GROUPED reports, mirroring the
 * theme-tags review queue. Nothing pays automatically.
 */

export const BOUNTY_AMOUNT_CENTS = 699; // $6.99 flat — the Individual monthly rate

/** Deterministic grouping key: reports on the same verse/date/track cluster. */
export function groupKey(themeTrack: string, reportDate: string, verseRef: string): string {
  return `${themeTrack}|${reportDate}|${verseRef}`;
}

function firstOfMonthUTC(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

// ─── reporting (public) ──────────────────────────────────────────────────────

export interface SubmitReportInput {
  reporterEmail: string;
  verseRef: string;
  themeTrack?: string;
  reportDate: string; // YYYY-MM-DD
  reportedText?: string;
  description: string;
  reporterStripeCustomerId?: string | null;
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
  const track = input.themeTrack?.trim() || "general";

  const { data, error } = await admin
    .from("igy_error_reports")
    .insert({
      reporter_email: input.reporterEmail.trim().toLowerCase(),
      reporter_stripe_customer_id: input.reporterStripeCustomerId ?? null,
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
  capped: boolean;
}

/**
 * Confirm or reject a whole group. On confirm, ONLY the earliest-timestamped
 * reporter earns a credit, subject to the monthly cap (1 rewarded report per
 * person per calendar month) — enforced HERE, at issuance.
 */
export async function confirmGroup(gkey: string, decision: "confirm" | "reject", staff: Staff, note?: string): Promise<ConfirmResult> {
  const admin = getSupabaseAdmin();
  const { data: reports, error } = await admin
    .from("igy_error_reports")
    .select("id, reporter_email, reporter_stripe_customer_id, submitted_at")
    .eq("group_key", gkey)
    .eq("status", "pending")
    .order("submitted_at", { ascending: true });
  if (error) throw new Error(`group_read_failed: ${error.message}`);
  if (!reports || reports.length === 0) throw new Error("no pending reports in this group");

  const newStatus = decision === "confirm" ? "confirmed" : "rejected";
  const { error: updErr } = await admin
    .from("igy_error_reports")
    .update({ status: newStatus, reviewed_by: staff.userId, reviewed_at: new Date().toISOString(), review_note: note?.trim() || null })
    .eq("group_key", gkey)
    .eq("status", "pending");
  if (updErr) throw new Error(`group_update_failed: ${updErr.message}`);

  if (decision === "reject") {
    return { group_key: gkey, decision, report_count: reports.length, winner_email: null, credited: false, capped: false };
  }

  // Confirmed: earliest reporter is the winner.
  const winner = reports[0];
  const creditMonth = firstOfMonthUTC();

  // Monthly cap — enforced at ISSUANCE: has this person already earned a credit this month?
  const { count, error: capErr } = await admin
    .from("igy_bounty_credits")
    .select("id", { count: "exact", head: true })
    .eq("reporter_email", winner.reporter_email)
    .eq("credit_month", creditMonth);
  if (capErr) throw new Error(`cap_check_failed: ${capErr.message}`);

  if ((count ?? 0) >= 1) {
    return { group_key: gkey, decision, report_count: reports.length, winner_email: winner.reporter_email, credited: false, capped: true };
  }

  const { error: credErr } = await admin.from("igy_bounty_credits").insert({
    report_id: winner.id,
    reporter_email: winner.reporter_email,
    reporter_stripe_customer_id: winner.reporter_stripe_customer_id ?? null,
    amount_cents: BOUNTY_AMOUNT_CENTS,
    status: "earned",
    issued_by: staff.userId,
    credit_month: creditMonth,
  });
  if (credErr) throw new Error(`credit_insert_failed: ${credErr.message}`);

  return { group_key: gkey, decision, report_count: reports.length, winner_email: winner.reporter_email, credited: true, capped: false };
}

// ─── credit ledger + manual redemption (mirrors donation fund) ───────────────

export interface CreditRow {
  id: string;
  reporter_email: string;
  amount_cents: number;
  status: string;
  issued_at: string;
  credit_month: string;
  applied_at: string | null;
  applied_note: string | null;
  report_id: string;
}
export interface ReporterBalance {
  reporter_email: string;
  earned_count: number;
  available_cents: number;
}
export interface BountyLedger {
  totalEarnedCents: number; // ever earned (earned + applied)
  availableCents: number; // status 'earned' — unredeemed
  appliedCents: number; // status 'applied'
  reporterBalances: ReporterBalance[];
  recentCredits: CreditRow[];
}

export async function getBountyLedger(): Promise<BountyLedger> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("igy_bounty_credits")
    .select("id, reporter_email, amount_cents, status, issued_at, credit_month, applied_at, applied_note, report_id")
    .order("issued_at", { ascending: false });
  if (error) throw new Error(`bounty_ledger_query_failed: ${error.message}`);
  const rows = (data ?? []) as CreditRow[];

  let totalEarned = 0, available = 0, applied = 0;
  const perReporter = new Map<string, ReporterBalance>();
  for (const c of rows) {
    if (c.status !== "expired") totalEarned += c.amount_cents;
    if (c.status === "earned") available += c.amount_cents;
    if (c.status === "applied") applied += c.amount_cents;
    const rb = perReporter.get(c.reporter_email) ?? { reporter_email: c.reporter_email, earned_count: 0, available_cents: 0 };
    if (c.status !== "expired") rb.earned_count++;
    if (c.status === "earned") rb.available_cents += c.amount_cents;
    perReporter.set(c.reporter_email, rb);
  }
  return {
    totalEarnedCents: totalEarned,
    availableCents: available,
    appliedCents: applied,
    reporterBalances: [...perReporter.values()].sort((a, b) => b.available_cents - a.available_cents),
    recentCredits: rows.slice(0, 40),
  };
}

/**
 * Manually redeem an earned credit — the deliberate human checkpoint before a
 * credit reduces what someone pays. Mirrors the donation fund's recordDisbursement.
 */
export async function applyCredit(creditId: string, staff: Staff, note?: string): Promise<BountyLedger> {
  const admin = getSupabaseAdmin();
  const { data: credit, error } = await admin
    .from("igy_bounty_credits").select("id, status").eq("id", creditId).single();
  if (error) throw new Error(`credit_read_failed: ${error.message}`);
  if (credit.status !== "earned") throw new Error(`credit is '${credit.status}', not 'earned' — cannot apply`);

  const { error: updErr } = await admin
    .from("igy_bounty_credits")
    .update({ status: "applied", applied_at: new Date().toISOString(), applied_by: staff.userId, applied_note: note?.trim() || null })
    .eq("id", creditId)
    .eq("status", "earned"); // guard against double-apply
  if (updErr) throw new Error(`credit_apply_failed: ${updErr.message}`);
  return getBountyLedger();
}
