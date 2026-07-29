import "server-only";
import type Stripe from "stripe";
import { getSupabaseAdmin } from "./supabaseAdmin";
import { getStripe } from "./stripe";
import { subscriptionMonthlyValueCents } from "./referral";
import type { Staff } from "./rbac";
import { earnedEmail, notFirstEmail, rejectedEmail, cappedEmail, snagEmail, alreadyCorrectedEmail, sendBountyEmail } from "./bountyEmails";

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

/** Deterministic grouping key: reports on the same verse/date/track AND the same
 *  text (en reword vs es translation) cluster. text_lang is part of the key because
 *  an EN error and an ES error on the same verse are distinct corrections. */
export function groupKey(themeTrack: string, reportDate: string, verseRef: string, textLang: string): string {
  return `${themeTrack}|${reportDate}|${verseRef}|${textLang}`;
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
  textLang: "en" | "es"; // which text: en reword vs es translation
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
  text_lang: string | null;
  ai_is_error: boolean | null;
  ai_assessment: string | null;
  ai_proposed_fix: string | null;
  ai_target_slot_id: string | null;
  ai_assessed_at: string | null;
}

export async function submitReport(input: SubmitReportInput): Promise<ReportRow> {
  const admin = getSupabaseAdmin();
  if (!input.reporterEmail?.trim()) throw new Error("reporter email is required");
  if (!input.verseRef?.trim()) throw new Error("verse reference is required");
  if (!input.reportDate?.trim()) throw new Error("report date is required");
  if (!input.description?.trim()) throw new Error("a description of the issue is required");
  if (input.textLang !== "en" && input.textLang !== "es") {
    throw new Error("please choose which text you're reporting — the English reword or the Spanish translation");
  }
  const email = input.reporterEmail.trim().toLowerCase();
  const track = input.themeTrack?.trim() || "general";
  const verseRef = input.verseRef.trim();
  const gkey = groupKey(track, input.reportDate, verseRef, input.textLang);

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

  // §8 Step 2 — already-resolved dedupe: this exact error (same group, incl. text_lang)
  // was already confirmed + fixed. Record it, thank them, no reward, skip the queue.
  const { count: resolvedCount, error: dupErr } = await admin
    .from("igy_error_reports")
    .select("id", { count: "exact", head: true })
    .eq("group_key", gkey)
    .eq("status", "confirmed");
  if (dupErr) throw new Error(`dedupe_check_failed: ${dupErr.message}`);
  const status = (resolvedCount ?? 0) > 0 ? "duplicate_resolved" : "pending";

  const { data, error } = await admin
    .from("igy_error_reports")
    .insert({
      reporter_email: email,
      reporter_stripe_customer_id: customerId,
      verse_ref: verseRef,
      theme_track: track,
      text_lang: input.textLang,
      report_date: input.reportDate,
      reported_text: input.reportedText?.trim() || null,
      description: input.description.trim(),
      group_key: gkey,
      status,
    })
    .select("id, reporter_email, verse_ref, theme_track, text_lang, report_date, reported_text, description, group_key, submitted_at, status")
    .single();
  if (error) throw new Error(`report_insert_failed: ${error.message}`);
  if (status === "duplicate_resolved") await sendBountyEmail(email, alreadyCorrectedEmail(verseRef));
  return data as ReportRow;
}

// ─── review queue (grouped, mirrors theme-tags) ──────────────────────────────

export interface ReviewGroup {
  group_key: string;
  verse_ref: string;
  theme_track: string;
  report_date: string;
  text_lang: string | null; // en reword vs es translation — which text this group is about
  reports: ReportRow[]; // earliest first
  earliest_reporter_email: string;
  report_count: number;
  assessment: GroupAssessment | null; // AI assessment (Phase B), null until Assess is run
  current_text: string | null; // the live slot text a publish would overwrite
  slot_ok: boolean; // does the report resolve to exactly one slot? (publish requires it)
  slot_note: string | null; // 'no_matching_slot' / 'multiple_matching_slots' when !slot_ok
}

export interface GroupAssessment {
  ai_is_error: boolean | null;
  ai_assessment: string | null;
  ai_proposed_fix: string | null;
  ai_target_slot_id: string | null;
  ai_assessed_at: string | null;
}

export async function getReviewGroups(status = "pending"): Promise<ReviewGroup[]> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("igy_error_reports")
    .select("id, reporter_email, verse_ref, theme_track, text_lang, report_date, reported_text, description, group_key, submitted_at, status, ai_is_error, ai_assessment, ai_proposed_fix, ai_target_slot_id, ai_assessed_at")
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
        text_lang: r.text_lang,
        reports: [],
        earliest_reporter_email: r.reporter_email, // first seen = earliest (ordered by submitted_at)
        report_count: 0,
        assessment: r.ai_assessed_at
          ? { ai_is_error: r.ai_is_error, ai_assessment: r.ai_assessment, ai_proposed_fix: r.ai_proposed_fix, ai_target_slot_id: r.ai_target_slot_id, ai_assessed_at: r.ai_assessed_at }
          : null,
        current_text: null,
        slot_ok: false,
        slot_note: null,
      };
      groups.set(r.group_key, g);
    }
    g.reports.push(r);
    g.report_count++;
  }

  // Resolve each group's live slot (for current-text display + publish-readiness).
  const list = [...groups.values()];
  await Promise.all(
    list.map(async (g) => {
      const s = await resolveSlot({ report_date: g.report_date, theme_track: g.theme_track, verse_ref: g.verse_ref, text_lang: g.text_lang });
      if (s.ok) { g.current_text = s.slot.currentText; g.slot_ok = true; g.slot_note = null; }
      else { g.current_text = null; g.slot_ok = false; g.slot_note = s.reason; }
    }),
  );
  return list;
}

// ─── report → live daily_slot resolution (foundation for assess/publish) ─────

export interface SlotResolution {
  slotId: string;
  field: "final_translation" | "final_translation_es";
  currentText: string | null;
  verseRef: string;
}
export type SlotResolveResult =
  | { ok: true; slot: SlotResolution }
  | { ok: false; reason: "no_matching_slot" | "multiple_matching_slots"; slotIds?: string[] };

/**
 * Map a report to the single live daily_slot + field its correction would edit.
 * Matches on scheduled_date=report_date, theme_track, verse_ref; text_lang picks
 * the field (en → final_translation, es → final_translation_es). Returns an
 * explicit failure for no-match / multi-match — callers never auto-guess a slot
 * (corrections_log.daily_slot_id is NOT NULL, so publishing requires exactly one).
 */
export async function resolveSlot(r: {
  report_date: string;
  theme_track: string;
  verse_ref: string;
  text_lang: string | null;
}): Promise<SlotResolveResult> {
  const admin = getSupabaseAdmin();
  const field = r.text_lang === "es" ? "final_translation_es" : "final_translation";
  const { data, error } = await admin
    .from("daily_slots")
    .select(`id, verse_ref, ${field}`)
    .eq("scheduled_date", r.report_date)
    .eq("theme_track", r.theme_track)
    .eq("verse_ref", r.verse_ref);
  if (error) throw new Error(`slot_resolve_failed: ${error.message}`);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return { ok: false, reason: "no_matching_slot" };
  if (rows.length > 1) return { ok: false, reason: "multiple_matching_slots", slotIds: rows.map((x) => String(x.id)) };
  const row = rows[0];
  return { ok: true, slot: { slotId: String(row.id), field, currentText: (row[field] as string | null) ?? null, verseRef: String(row.verse_ref) } };
}

// ─── AI assessment (Phase B, on-demand) ─────────────────────────────────────

/** Assessment model — a CURRENT Claude by default (not the older sonnet-4-6 the
 *  verse generator still pins). Override via env. Single-model: the human is the gate. */
const ASSESS_MODEL = process.env.BOUNTY_ASSESS_MODEL || "claude-sonnet-5";

/** Stand-in reviewer id for the deferred-login phase — no FK on corrected_by /
 *  reviewer_id, so any uuid is fine; matches lib/reviewFunctions' fallback. */
const FALLBACK_REVIEWER_ID = "00000000-0000-0000-0000-000000000001";

/** "John 3:16" / "1 Corinthians 13:4" / "Song of Solomon 2:1" -> {book,chapter,verse}. */
function parseVerseRef(ref: string): { book: string; chapter: number; verse: number } | null {
  const m = ref.trim().match(/^(.+?)\s+(\d+):(\d+)$/);
  if (!m) return null;
  return { book: m[1].trim(), chapter: Number(m[2]), verse: Number(m[3]) };
}

/** Best-effort canonical source text: KJV for the EN reword, RV1909 for the ES
 *  translation. Returns null if it can't be resolved (assessment still proceeds). */
async function fetchSourceVerse(verseRef: string, lang: "en" | "es"): Promise<string | null> {
  const p = parseVerseRef(verseRef);
  if (!p) return null;
  const table = lang === "es" ? "rv1909_verses" : "kjv_verses";
  try {
    const admin = getSupabaseAdmin();
    const { data } = await admin
      .from(table)
      .select("text")
      .eq("book", p.book).eq("chapter", p.chapter).eq("verse", p.verse)
      .maybeSingle();
    return (data as { text?: string } | null)?.text ?? null;
  } catch {
    return null;
  }
}

interface AssessDraft { is_error: boolean; assessment: string; proposed_fix: string | null }

/** Single Claude call → structured verdict. Throws if ANTHROPIC_API_KEY is unset
 *  (assessment is admin-triggered; a clear error beats a silent no-op here). */
async function callAssessLLM(prompt: string): Promise<AssessDraft> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("assessment_unavailable: ANTHROPIC_API_KEY is not set");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: ASSESS_MODEL, max_tokens: 800, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`assess_llm_${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { content?: Array<{ text?: string }> };
  const raw = body.content?.map((c) => c.text ?? "").join("") ?? "";
  const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
  if (s === -1 || e === -1 || e < s) throw new Error("assess_parse_failed: no JSON object in model output");
  const parsed = JSON.parse(raw.slice(s, e + 1)) as Partial<AssessDraft>;
  return {
    is_error: Boolean(parsed.is_error),
    assessment: String(parsed.assessment ?? "").trim(),
    proposed_fix: parsed.proposed_fix ? String(parsed.proposed_fix).trim() : null,
  };
}

function buildAssessPrompt(lang: "en" | "es", verseRef: string, currentText: string | null, source: string | null, reportedText: string | null, description: string): string {
  const src = source ? `Canonical source (${lang === "es" ? "Reina-Valera 1909" : "KJV"}): "${source}"` : "(canonical source unavailable)";
  const cur = currentText ? `Currently published text: "${currentText}"` : "(current published text unavailable)";
  const frame = lang === "es"
    ? `You are reviewing the Spanish (Reina-Valera 1909-based) rendering of ${verseRef} used in a teen Scripture devotional.`
    : `You are reviewing the English teen-slang reword (based on the KJV) of ${verseRef} used in a daily teen Scripture devotional.`;
  const fixNote = lang === "es"
    ? "If it should change, provide a corrected Spanish rendering faithful to Reina-Valera 1909."
    : "If it should change, provide a corrected teen-slang reword that stays faithful to the KJV meaning AND keeps the same casual teen-slang register as the current text.";
  return `${frame}
${src}
${cur}
A subscriber reported an issue:
- specific text they flagged: ${reportedText ? `"${reportedText}"` : "(not given)"}
- what they said is wrong: "${description}"

Decide whether the current text is ACTUALLY wrong (mistranslation / factual error / misrepresents the verse / inappropriate), versus merely a stylistic choice the reporter happens to dislike. Be conservative: only flag a real error. ${fixNote}
Respond with ONLY a JSON object, no prose: {"is_error": true|false, "assessment": "1-3 sentence reasoning", "proposed_fix": "corrected text" or null}`;
}

export interface AssessResult {
  group_key: string;
  slot_error?: "no_matching_slot" | "multiple_matching_slots";
  ai_is_error: boolean | null;
  ai_assessment: string;
  ai_proposed_fix: string | null;
  ai_target_slot_id: string | null;
}

/**
 * On-demand AI assessment of a pending group (spec §8 Step 3): resolve the slot,
 * ground on the canonical source + current text, ask Claude whether it's really an
 * error and (if so) draft a fix, and persist the verdict on the group's pending
 * rows. NEVER publishes — a human approves in Phase C.
 */
export async function assessReport(gkey: string): Promise<AssessResult> {
  const admin = getSupabaseAdmin();
  const { data: reps, error } = await admin
    .from("igy_error_reports")
    .select("verse_ref, theme_track, report_date, text_lang, reported_text, description")
    .eq("group_key", gkey).eq("status", "pending")
    .order("submitted_at", { ascending: true }).limit(1);
  if (error) throw new Error(`assess_group_read_failed: ${error.message}`);
  const rep = (reps ?? [])[0] as
    | { verse_ref: string; theme_track: string; report_date: string; text_lang: string | null; reported_text: string | null; description: string }
    | undefined;
  if (!rep) throw new Error("no pending reports in this group");
  const lang: "en" | "es" = rep.text_lang === "es" ? "es" : "en";

  const persist = async (fields: Record<string, unknown>) => {
    await admin.from("igy_error_reports").update({ ...fields, ai_assessed_at: new Date().toISOString() })
      .eq("group_key", gkey).eq("status", "pending");
  };

  const slot = await resolveSlot(rep);
  if (!slot.ok) {
    const msg = slot.reason === "no_matching_slot"
      ? "No matching daily_slot for this report's date/track/verse — can't assess or publish. Verify the report details or map a slot manually."
      : `Multiple daily_slots match (${(slot.slotIds ?? []).join(", ")}) — can't auto-target. Resolve manually.`;
    await persist({ ai_is_error: null, ai_assessment: msg, ai_proposed_fix: null, ai_target_slot_id: null });
    return { group_key: gkey, slot_error: slot.reason, ai_is_error: null, ai_assessment: msg, ai_proposed_fix: null, ai_target_slot_id: null };
  }

  const source = await fetchSourceVerse(rep.verse_ref, lang);
  const draft = await callAssessLLM(buildAssessPrompt(lang, rep.verse_ref, slot.slot.currentText, source, rep.reported_text, rep.description));
  await persist({ ai_is_error: draft.is_error, ai_assessment: draft.assessment, ai_proposed_fix: draft.proposed_fix, ai_target_slot_id: slot.slot.slotId });
  return { group_key: gkey, ai_is_error: draft.is_error, ai_assessment: draft.assessment, ai_proposed_fix: draft.proposed_fix, ai_target_slot_id: slot.slot.slotId };
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

// ─── publish a correction to live content (Phase C) ─────────────────────────

export interface PublishResult {
  group_key: string;
  slot_id: string;
  corrections_log_id: string;
  reward: ConfirmResult; // status + credit outcome from the finalize step
}

/**
 * Approve + publish a confirmed error's fix to the live daily_slots content, fully
 * audit-trailed. Opens a review_session, overwrites the target slot's en/es field,
 * logs a corrections_log entry bound to that session, then delegates status +
 * reward to confirmGroup("confirm") — so the credit fires only after a successful
 * publish. `finalText` is the AI's proposed fix or the admin's edit. Gated at the
 * API layer behind content.queue.publish (super_admin).
 */
export async function publishCorrection(gkey: string, finalText: string, staff: Staff, note?: string): Promise<PublishResult> {
  const admin = getSupabaseAdmin();
  if (!finalText?.trim()) throw new Error("a corrected text is required to publish");
  const text = finalText.trim();

  // Read the pending group (status still 'pending' here) to resolve the slot.
  const { data, error } = await admin
    .from("igy_error_reports")
    .select("verse_ref, theme_track, report_date, text_lang")
    .eq("group_key", gkey)
    .eq("status", "pending")
    .order("submitted_at", { ascending: true })
    .limit(1);
  if (error) throw new Error(`publish_group_read_failed: ${error.message}`);
  const rep = (data ?? [])[0] as { verse_ref: string; theme_track: string; report_date: string; text_lang: string | null } | undefined;
  if (!rep) throw new Error("no pending reports in this group");

  const slot = await resolveSlot(rep);
  if (!slot.ok) throw new Error(`cannot publish: ${slot.reason} — resolve the target slot first`);
  const now = new Date().toISOString();
  const reviewerUuid = staff.userId ?? FALLBACK_REVIEWER_ID;

  // Open a review session (reuse the review apparatus at the table level).
  const { data: sess, error: sErr } = await admin
    .from("review_sessions")
    .insert({ reviewer_id: reviewerUuid, started_at: now })
    .select("id")
    .single();
  if (sErr) throw new Error(`review_session_open_failed: ${sErr.message}`);
  const sessionId = (sess as { id: string }).id;

  // Publish: overwrite the slot's target-language field with the corrected text.
  const { error: slotErr } = await admin.from("daily_slots").update({ [slot.slot.field]: text }).eq("id", slot.slot.slotId);
  if (slotErr) throw new Error(`slot_publish_failed: ${slotErr.message}`);

  // Audit: corrections_log entry bound to the session (pre-image = original text).
  const { data: corr, error: cErr } = await admin
    .from("corrections_log")
    .insert({
      daily_slot_id: slot.slot.slotId,
      action_type: "bounty_correction",
      original_verse_ref: rep.verse_ref,
      original_translation: slot.slot.currentText,
      corrected_translation: text,
      reason: note?.trim() || `error-bounty correction (${slot.slot.field === "final_translation_es" ? "es" : "en"})`,
      category: "error_bounty",
      corrected_by: reviewerUuid,
      corrected_at: now,
      review_session_id: sessionId,
    })
    .select("id")
    .single();
  if (cErr) throw new Error(`corrections_log_write_failed: ${cErr.message}`);
  const corrId = (corr as { id: string }).id;

  await admin.from("review_sessions").update({ ended_at: now, ended_cleanly: true }).eq("id", sessionId);

  // Finalize: mark the group confirmed + issue the reward (reuses the confirm path;
  // reports are still 'pending' at this point). Content is already live and logged.
  const reward = await confirmGroup(gkey, "confirm", staff, note);

  return { group_key: gkey, slot_id: slot.slot.slotId, corrections_log_id: corrId, reward };
}

// ─── corrections history (read-only) ────────────────────────────────────────

export interface CorrectionRow {
  id: string;
  daily_slot_id: string;
  action_type: string; // bounty_correction | bounty_revert
  original_verse_ref: string | null;
  original_translation: string | null;
  corrected_translation: string | null;
  corrected_at: string | null;
  review_session_id: string | null;
}

/** Error-bounty corrections + reverts, newest first, for the admin history panel. */
export async function getBountyCorrections(limit = 40): Promise<CorrectionRow[]> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("corrections_log")
    .select("id, daily_slot_id, action_type, original_verse_ref, original_translation, corrected_translation, corrected_at, review_session_id")
    .eq("category", "error_bounty")
    .order("corrected_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`corrections_query_failed: ${error.message}`);
  return (data ?? []) as CorrectionRow[];
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
