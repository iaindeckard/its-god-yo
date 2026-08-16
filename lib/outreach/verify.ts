import "server-only";
import { promises as dns } from "dns";
import { getSupabaseAdmin } from "../supabaseAdmin";
import type { OutreachLead } from "./leads";
import { isGeneralAddress } from "./config";

/**
 * Pre-send verification for outreach leads. Before a lead can be included in a
 * LIVE send it must pass BOTH:
 *   (A) source-page check — one of its cited source_urls actually mentions the
 *       org name AND something youth-ministry-related, and
 *   (B) email-domain check — the contact_email is well-formed and its domain
 *       accepts mail (an MX record, or per RFC 5321 an implicit-MX A/AAAA record).
 *
 * Locked rule (Iain): both must pass for 'passed'; EITHER failing/inconclusive ->
 * 'needs_manual' (never auto-rejected). A human with marketing.outreach.verify_
 * override can clear a needs_manual lead to 'manual_override'. Verification is
 * orthogonal to `status` and expires after VERIFICATION_TTL_DAYS.
 *
 * All page fetches are best-effort, time-boxed, and polite (descriptive UA); a
 * fetch we can't complete leaves the lead needs_manual, so the send gate holds it.
 */

const TABLE = "igy_outreach_leads";

/** A lead's verification must be re-confirmed if older than this many days. */
export const VERIFICATION_TTL_DAYS = 90;

export type VerificationStatus =
  | "unverified" | "passed" | "failed" | "needs_manual" | "manual_override";

export interface VerificationNotes {
  checked_url: string | null;
  org_match: boolean;
  youth_match: boolean;
  matched_keyword: string | null;
  page_reason: string | null;   // why the page check couldn't positively confirm
  email_format_ok: boolean;
  mx_ok: boolean;
  mx_host: string | null;
  mx_reason: string | null;
  checked_at: string;
}

export interface VerificationResult {
  status: VerificationStatus;
  notes: VerificationNotes;
}

/** A lead is send-eligible only if it PASSED (or was manually overridden) AND the
 *  verification is still fresh (within the TTL). This is the predicate the send
 *  gate calls — see lib/outreach/run.ts. */
export function isSendable(
  lead: Pick<OutreachLead, "verification_status" | "verified_at">,
): boolean {
  if (lead.verification_status !== "passed" && lead.verification_status !== "manual_override") return false;
  if (!lead.verified_at) return false;
  const ageDays = (Date.now() - new Date(lead.verified_at).getTime()) / 86_400_000;
  return Number.isFinite(ageDays) && ageDays <= VERIFICATION_TTL_DAYS;
}

// ---- Page check -----------------------------------------------------------

const FETCH_TIMEOUT_MS = 6000;
const MAX_BYTES = 500_000;
const USER_AGENT = "ItsGodYo-Outreach-Verify/1.0 (hello@itsgodyo.com)";

// A youth/student-ministry signal on the page. Lowercased substring match.
const YOUTH_KEYWORDS = [
  "youth ministry", "youth group", "youth pastor", "youth director", "student ministry",
  "students ministry", "youth", "teens", "teen ", "middle school", "high school",
  "junior high", "jr high", "confirmation class", "young life", "youth night",
];

// Generic words in a church name that don't identify it — excluded from the
// token-overlap match so "First Baptist Church" doesn't pass on "church" alone.
const ORG_STOPWORDS = new Set([
  "the", "of", "and", "a", "an", "st", "church", "churches", "ministries", "ministry",
  "fellowship", "community", "christian", "baptist", "methodist", "presbyterian",
  "catholic", "lutheran", "assembly", "assemblies", "god", "first", "new", "life",
  "grace", "faith", "bible", "chapel", "center", "centre", "house", "worship",
  "international", "gospel", "temple", "cathedral", "parish",
]);

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function htmlToText(html: string): string {
  return html
    .replace(/mailto:([^"'?\s>]+)/gi, " $1 ")
    .replace(/&#64;|&#x40;|&commat;/gi, "@")
    .replace(/&#46;|&#x2e;/gi, ".")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

interface FetchedPage { text: string | null; reason: string | null }

async function fetchPageText(url: string): Promise<FetchedPage> {
  let u: URL;
  try { u = new URL(url); } catch { return { text: null, reason: "invalid_url" }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { text: null, reason: "non_http_url" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(u.toString(), {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,text/plain,*/*" },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (!res.ok) return { text: null, reason: `http_${res.status}` };
    const ctype = res.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml|text\/plain/i.test(ctype)) {
      return { text: null, reason: `non_html:${ctype.split(";")[0] || "unknown"}` };
    }
    const raw = (await res.text()).slice(0, MAX_BYTES);
    const text = htmlToText(raw);
    if (!text.trim()) return { text: null, reason: "empty_after_strip" };
    return { text, reason: null };
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    return { text: null, reason: name === "AbortError" ? "timeout" : "fetch_error" };
  } finally {
    clearTimeout(timer);
  }
}

function orgMatches(org: string, pageText: string): boolean {
  const norm = normalize(org);
  if (norm && pageText.includes(norm)) return true; // full normalized name present
  const tokens = norm.split(" ").filter((t) => t.length >= 3 && !ORG_STOPWORDS.has(t));
  if (tokens.length === 0) return false; // name is entirely generic -> can't token-match
  const hits = tokens.filter((t) => pageText.includes(t)).length;
  return hits / tokens.length >= 0.6;
}

function youthMatches(pageText: string): { ok: boolean; keyword: string | null } {
  for (const k of YOUTH_KEYWORDS) if (pageText.includes(k)) return { ok: true, keyword: k.trim() };
  return { ok: false, keyword: null };
}

// ---- Email / MX check -----------------------------------------------------

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function checkEmailDomain(email: string): Promise<{
  format_ok: boolean; mx_ok: boolean; host: string | null; reason: string | null;
}> {
  const clean = (email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(clean)) return { format_ok: false, mx_ok: false, host: null, reason: "bad_format" };
  const domain = clean.split("@")[1];
  try {
    const mx = await dns.resolveMx(domain);
    if (mx && mx.length) {
      const best = [...mx].sort((a, b) => a.priority - b.priority)[0];
      return { format_ok: true, mx_ok: true, host: best.exchange, reason: null };
    }
  } catch { /* no MX -> fall through to implicit-MX A/AAAA per RFC 5321 */ }
  try {
    const a = await dns.resolve4(domain);
    if (a && a.length) return { format_ok: true, mx_ok: true, host: domain, reason: "implicit_mx_a_record" };
  } catch { /* none */ }
  try {
    const aaaa = await dns.resolve6(domain);
    if (aaaa && aaaa.length) return { format_ok: true, mx_ok: true, host: domain, reason: "implicit_mx_aaaa_record" };
  } catch { /* none */ }
  return { format_ok: true, mx_ok: false, host: null, reason: "no_mx_or_a_record" };
}

function pageHostname(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try { return new URL(raw).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; }
}

function relatedHostname(a: string, b: string): boolean {
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

export async function validateReplacementContactEmail(
  lead: Pick<OutreachLead, "org_name" | "website">,
  email: string,
  sourceUrl: string,
  manuallyConfirmed = false,
): Promise<{ email: string; sourceUrl: string; automatedEvidenceConfirmed: boolean }> {
  const cleanEmail = email.trim().toLowerCase();
  if (!EMAIL_RE.test(cleanEmail)) throw new Error("Enter a valid email address.");
  if (!isGeneralAddress(cleanEmail)) {
    throw new Error("Use a public general or office inbox, not an individual staff address.");
  }
  let normalizedSource: string;
  try {
    const parsed = new URL(sourceUrl.trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error("invalid");
    normalizedSource = parsed.toString();
  } catch {
    throw new Error("Enter the public church webpage where this email is displayed.");
  }
  const sourceHost = pageHostname(normalizedSource);
  const websiteHost = pageHostname(lead.website);
  const emailHost = cleanEmail.split('@')[1];
  if (websiteHost && sourceHost && !relatedHostname(sourceHost, websiteHost) && !relatedHostname(sourceHost, emailHost)) {
    throw new Error("The source must be on the church website or the email domain.");
  }
  const page = await fetchPageText(normalizedSource);
  const automatedEvidenceConfirmed = Boolean(page.text && orgMatches(lead.org_name, page.text) && page.text.includes(cleanEmail));
  if (!automatedEvidenceConfirmed && !manuallyConfirmed) {
    throw new Error(page.text
      ? "The automated check could not confirm the church and replacement email on that page."
      : `The source page could not be verified (${page.reason ?? "unavailable"}).`);
  }
  const mx = await checkEmailDomain(cleanEmail);
  if (!mx.format_ok || !mx.mx_ok) throw new Error("The replacement email domain does not currently accept mail.");
  return { email: cleanEmail, sourceUrl: normalizedSource, automatedEvidenceConfirmed };
}

// ---- Per-lead verification ------------------------------------------------

/** Run both checks for one lead and return a verdict + evidence. Pure w.r.t. the
 *  DB (no write) — callers persist via setVerification/verifyLeads. */
export async function verifyLead(
  lead: Pick<OutreachLead, "org_name" | "contact_email" | "source_urls">,
): Promise<VerificationResult> {
  const checked_at = new Date().toISOString();
  const mx = await checkEmailDomain(lead.contact_email);

  // Check across ALL cited source_urls (the discovery prompt allows the email and
  // the youth signal to live on different pages) until both are confirmed.
  const urls = (Array.isArray(lead.source_urls) ? lead.source_urls : []).filter(Boolean).slice(0, 4);
  let orgOk = false, youthOk = false, matchedKeyword: string | null = null;
  let checkedUrl: string | null = null, firstFetchReason: string | null = null, anyFetched = false;
  for (const url of urls) {
    const { text, reason } = await fetchPageText(url);
    if (!text) { if (!firstFetchReason) firstFetchReason = reason; continue; }
    anyFetched = true;
    if (!checkedUrl) checkedUrl = url;
    if (!orgOk && orgMatches(lead.org_name, text)) { orgOk = true; checkedUrl = url; }
    if (!youthOk) { const y = youthMatches(text); if (y.ok) { youthOk = true; matchedKeyword = y.keyword; } }
    if (orgOk && youthOk) break;
  }

  const emailPass = mx.format_ok && mx.mx_ok;
  const pageConfirmed = orgOk && youthOk;

  // Locked rule: both pass -> passed; anything else -> needs_manual (never
  // auto-'failed'). Evidence in notes tells the reviewer exactly what to look at.
  const status: VerificationStatus = emailPass && pageConfirmed ? "passed" : "needs_manual";

  const page_reason = pageConfirmed
    ? null
    : urls.length === 0
      ? "no_source_urls"
      : anyFetched
        ? "page_missing_org_or_youth"
        : (firstFetchReason ?? "fetch_failed");

  return {
    status,
    notes: {
      checked_url: checkedUrl,
      org_match: orgOk,
      youth_match: youthOk,
      matched_keyword: matchedKeyword,
      page_reason,
      email_format_ok: mx.format_ok,
      mx_ok: mx.mx_ok,
      mx_host: mx.host,
      mx_reason: mx.reason,
      checked_at,
    },
  };
}

/** Persist an automated verification result. verified_at is stamped only on a
 *  'passed' verdict (needs_manual clears it, so a stale/held lead stays blocked). */
export async function setVerification(id: string, v: VerificationResult): Promise<void> {
  const admin = getSupabaseAdmin();
  const now = new Date().toISOString();
  const { error } = await admin.from(TABLE).update({
    verification_status: v.status,
    verified_at: v.status === "passed" ? now : null,
    verification_notes: v.notes,
    updated_at: now,
  }).eq("id", id);
  if (error) throw new Error(`set_verification_failed: ${error.message}`);
}

export interface VerifyBatchResult { checked: number; passed: number; needs_manual: number }

/**
 * Verify a set of leads and persist each verdict. Reusable for every campaign:
 *   - { campaignId }              -> (re)verify all of that campaign's leads
 *   - { onlyUnverified: true }    -> only leads never checked (auto-hook after discovery)
 *   - { ids }                     -> a specific subset
 * A 'manual_override' lead is never re-verified (a human deliberately cleared it).
 * Small concurrency keeps large campaigns polite and inside the route's maxDuration.
 */
export async function verifyLeads(scope: {
  campaignId?: string; ids?: string[]; onlyUnverified?: boolean;
}): Promise<VerifyBatchResult> {
  const admin = getSupabaseAdmin();
  let q = admin.from(TABLE).select("id, org_name, contact_email, source_urls, verification_status");
  if (scope.campaignId) q = q.eq("campaign_id", scope.campaignId);
  if (scope.ids && scope.ids.length) q = q.in("id", scope.ids);
  if (scope.onlyUnverified) q = q.eq("verification_status", "unverified");
  const { data, error } = await q;
  if (error) throw new Error(`verify_fetch_failed: ${error.message}`);
  const leads = (data ?? []) as Array<
    Pick<OutreachLead, "id" | "org_name" | "contact_email" | "source_urls" | "verification_status">
  >;

  const result: VerifyBatchResult = { checked: 0, passed: 0, needs_manual: 0 };
  const CONCURRENCY = 4;
  for (let i = 0; i < leads.length; i += CONCURRENCY) {
    const chunk = leads.slice(i, i + CONCURRENCY);
    const statuses = await Promise.all(chunk.map(async (lead) => {
      if (lead.verification_status === "manual_override") return null; // never re-check an override
      const v = await verifyLead(lead);
      await setVerification(lead.id, v);
      return v.status;
    }));
    for (const s of statuses) {
      if (s == null) continue;
      result.checked++;
      if (s === "passed") result.passed++; else result.needs_manual++;
    }
  }
  return result;
}

/** Manual override (gated by marketing.outreach.verify_override in the route):
 *  mark a lead verified by hand and stamp who/when, preserving prior automated
 *  evidence in the notes. Returns false if the lead id doesn't exist. */
export async function applyManualOverride(id: string, actorUserId: string): Promise<boolean> {
  const admin = getSupabaseAdmin();
  const now = new Date().toISOString();
  const { data: existing } = await admin.from(TABLE)
    .select("verification_notes").eq("id", id).maybeSingle();
  if (!existing) return false;
  const prior = (existing.verification_notes as Record<string, unknown> | null) ?? {};
  const notes = { ...prior, manual_override: true, overridden_by: actorUserId, overridden_at: now };
  const { data, error } = await admin.from(TABLE).update({
    verification_status: "manual_override",
    verified_at: now,
    verification_notes: notes,
    updated_at: now,
  }).eq("id", id).select("id");
  if (error) throw new Error(`manual_override_failed: ${error.message}`);
  return (data ?? []).length > 0;
}
