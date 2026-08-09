import "server-only";
import { getSupabaseAdmin } from "./supabaseAdmin";
import { sendSms } from "./dailySend";
import { smsCostCents, TWILIO_US_SEGMENT_PRICE_CENTS, TWILIO_US_TOLLFREE_CARRIER_FEE_CENTS } from "./costs";
import { baseIntervalForPlanKey } from "./plans";

/**
 * Day-14-to-21 "DM from Him" retention upsell.
 *
 * A one-time cross-sell SMS to a live subscriber who does NOT have the DM add-on,
 * fired once in their 14-21 day post-signup window. Exactly-once is enforced by the
 * claim-first upsert into dm_upsell_log (UNIQUE(pending_signup_id)) — the same
 * race-safe primitive the daily send uses; any existing row (sent/accepted/failed)
 * means we never prompt that subscription again, so a passive decliner is excluded
 * permanently.
 *
 * Acceptance reuses the existing DM ON keyword: the copy tells the subscriber to
 * reply DM ON, which runs setDmAddon (flips the flag + adds the Stripe line item).
 * The inbound handler stamps this log 'accepted' on that reply.
 *
 * v1 SCOPE: individual + gift plans only (a single, unambiguous recipient phone).
 * Family/group (multiple teen phones under one subscription) is intentionally
 * deferred until the "which phone gets the prompt" question is decided.
 *
 * Anchor = pending_signups.subscription_created_at (day 0 = subscription/trial
 * start). Eligibility otherwise mirrors the daily_send_audience predicate.
 *
 * DRAFT COPY: the wording below is preliminarily approved as a CONCEPT only. Do not
 * flip DM_UPSELL_ENABLED true until the exact copy has sign-off.
 */

export const DM_UPSELL_V1_PLAN_KEYS = ["individual_monthly", "individual_annual", "gift_annual"] as const;
const WINDOW_START_DAYS = 14;
const WINDOW_END_DAYS = 21;
const DAY_MS = 86_400_000;

type Lang = "en" | "es";

/** The correct DM price string for a subscriber, whose add-on interval must match
 *  their base plan (monthly base -> $2.99/mo; annual base -> $35.88/yr). */
export function dmUpsellPriceLabel(planKey: string | null | undefined, lang: Lang): string {
  const interval = baseIntervalForPlanKey(planKey);
  if (interval === "month") return lang === "es" ? "$2.99/mes" : "$2.99/mo";
  return lang === "es" ? "$35.88/año" : "$35.88/yr";
}

/** DRAFT upsell copy (EN/ES), pending final sign-off. */
export function composeUpsellMessage(firstName: string | null, planKey: string | null, lang: Lang): string {
  const name = (firstName ?? "").trim();
  const hi = name ? `${name}, ` : "";
  const price = dmUpsellPriceLabel(planKey, lang);
  if (lang === "es") {
    return `${hi}¿quieres tu versículo diario como una nota personal en Su voz, escrita solo para ti? Eso es DM from Him. Actívalo por ${price}. Responde DM ON, o no hagas nada para dejar todo igual.`;
  }
  return `${hi}want your daily verse written like a personal note in His voice, just for you? That's DM from Him. Add it for ${price}. Reply DM ON to turn it on, or do nothing to keep things as they are.`;
}

export interface DmUpsellSummary {
  ran_at: string;
  dry_run: boolean;
  in_window: number;   // eligible signups in the 14-21d window (before once-ever exclusion)
  would_send: number;  // dry-run: not yet prompted
  sent: number;
  failed: number;
  already: number;     // claim lost -> already prompted
  details: Array<{ pending_signup_id: string; lang: Lang; result: string; sid?: string; error?: string }>;
}

interface EligibleRow {
  id: string;
  plan_key: string | null;
  phone: string;
  firstName: string | null;
  lang: Lang;
}

/** Load subscribers in the 14-21d window, no DM add-on, v1 plans, with a confirmed
 *  recipient. For individual/gift (v1) the recipient is pending_signups.teen_consent_id
 *  (NOT NULL, always set) -> consent_log.id. We resolve via that FK, NOT via
 *  consent_log.pending_signup_id (which the daily_send_audience view only uses as one
 *  arm of a three-way OR, and which is null for individual signups). */
async function loadEligible(): Promise<EligibleRow[]> {
  const admin = getSupabaseAdmin();
  const now = Date.now();
  const olderThan = new Date(now - WINDOW_START_DAYS * DAY_MS).toISOString(); // created >= 14d ago
  const newerThan = new Date(now - WINDOW_END_DAYS * DAY_MS).toISOString();   // created <= 21d ago

  const { data: signups, error: sErr } = await admin
    .from("pending_signups")
    .select("id, plan_key, language, teen_consent_id, subscription_created_at")
    .in("plan_key", DM_UPSELL_V1_PLAN_KEYS as unknown as string[])
    .in("status", ["subscription_created", "active"])
    .eq("dm_addon", false)
    .not("stripe_subscription_id", "is", null)
    .lt("subscription_created_at", olderThan)
    .gte("subscription_created_at", newerThan);
  if (sErr) throw new Error(`dm_upsell_eligible_failed: ${sErr.message}`);
  const list = (signups ?? []) as { id: string; plan_key: string | null; language: string | null; teen_consent_id: string | null; subscription_created_at: string }[];
  if (list.length === 0) return [];

  const consentIds = list.map((s) => s.teen_consent_id).filter((v): v is string => !!v);
  if (consentIds.length === 0) return [];
  const { data: consents, error: cErr } = await admin
    .from("consent_log")
    .select("id, recipient_phone, recipient_first_name, language, consent_status")
    .in("id", consentIds)
    .eq("consent_status", "confirmed");
  if (cErr) throw new Error(`dm_upsell_consent_failed: ${cErr.message}`);
  const byConsentId = new Map<string, { recipient_phone: string; recipient_first_name: string | null; language: string | null }>();
  for (const c of (consents ?? []) as { id: string; recipient_phone: string; recipient_first_name: string | null; language: string | null }[]) {
    if (c.recipient_phone) byConsentId.set(c.id, c);
  }

  const out: EligibleRow[] = [];
  for (const s of list) {
    const c = s.teen_consent_id ? byConsentId.get(s.teen_consent_id) : undefined;
    if (!c) continue; // recipient not confirmed (e.g. opted out) -> skip
    const lang: Lang = (s.language ?? c.language) === "es" ? "es" : "en";
    out.push({ id: s.id, plan_key: s.plan_key, phone: c.recipient_phone, firstName: c.recipient_first_name, lang });
  }
  return out;
}

export async function runDmUpsell(opts: { dryRun: boolean }): Promise<DmUpsellSummary> {
  const admin = getSupabaseAdmin();
  const summary: DmUpsellSummary = { ran_at: new Date().toISOString(), dry_run: opts.dryRun, in_window: 0, would_send: 0, sent: 0, failed: 0, already: 0, details: [] };

  const eligible = await loadEligible();
  summary.in_window = eligible.length;

  for (const r of eligible) {
    // Claim-first: the UNIQUE(pending_signup_id) upsert returns 0 rows if this
    // subscription was ever prompted -> skip (never re-prompt). In dry-run we don't
    // write; we just check existence so the count reflects who WOULD be prompted.
    if (opts.dryRun) {
      const { data: existing } = await admin.from("dm_upsell_log").select("id").eq("pending_signup_id", r.id).maybeSingle();
      if (existing) { summary.already++; continue; }
      summary.would_send++;
      summary.details.push({ pending_signup_id: r.id, lang: r.lang, result: "would_send" });
      continue;
    }

    const { data: claim, error: claimErr } = await admin
      .from("dm_upsell_log")
      .upsert({ pending_signup_id: r.id, status: "claimed", language: r.lang }, { onConflict: "pending_signup_id", ignoreDuplicates: true })
      .select("id");
    if (claimErr) { summary.failed++; summary.details.push({ pending_signup_id: r.id, lang: r.lang, result: "failed", error: claimErr.message }); continue; }
    if (!claim || claim.length === 0) { summary.already++; continue; }

    const body = composeUpsellMessage(r.firstName, r.plan_key, r.lang);
    try {
      const { sid, segments } = await sendSms(r.phone, body);
      await admin.from("dm_upsell_log").update({ status: "sent", message_sid: sid, updated_at: new Date().toISOString() }).eq("pending_signup_id", r.id);
      const seg = segments ?? 1;
      const { error: costErr } = await admin.from("igy_sms_log").insert({
        message_sid: sid,
        direction: "outbound",
        segments: seg,
        unit_price_cents: seg * TWILIO_US_SEGMENT_PRICE_CENTS,
        carrier_fee_cents: seg * TWILIO_US_TOLLFREE_CARRIER_FEE_CENTS,
        cost_cents: smsCostCents(seg),
        sent_on: new Date().toISOString().slice(0, 10),
        sent_at: new Date().toISOString(),
        pending_signup_id: r.id,
        notes: `dm-upsell/${r.lang}`,
      });
      if (costErr) console.error(`[dm-upsell] cost_log_failed sid=${sid}: ${costErr.message}`);
      summary.sent++;
      summary.details.push({ pending_signup_id: r.id, lang: r.lang, result: "sent", sid });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await admin.from("dm_upsell_log").update({ status: "failed", error: msg.slice(0, 200), updated_at: new Date().toISOString() }).eq("pending_signup_id", r.id);
      summary.failed++;
      summary.details.push({ pending_signup_id: r.id, lang: r.lang, result: "failed", error: msg });
    }
  }

  return summary;
}
