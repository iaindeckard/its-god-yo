import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toE164 } from "./phone";
import { evaluateAgeGate } from "./ageGate";
import { sendSms } from "./sms";
import { issueBalanceCredit } from "./balanceCredit";
import { nonConfirmationCreditEmail, ageGateFailureCreditEmail, sendChristmasGiftEmail } from "./christmasGiftEmails";

/**
 * Christmas Scheduled Gift 2026 release-day job (daily cron). Four idempotent passes,
 * self-contained to the campaign table + consent_log (no change to other plans):
 *
 *  1. RELEASE      awaiting_release + release_at <= today (CT): run the age gate; on a
 *                  block, credit immediately + age-gate email (no text sent); otherwise
 *                  create the consent row and send the confirmation SMS.
 *  2. RESEND       one reminder ~7 days after the first send if still unconfirmed.
 *  3. CREDIT       ~30 days after the first send with no confirmation: convert to account
 *                  credit + the generic non-confirmation email.
 *  4. DEACTIVATE   prepaid_active whose gifted year has ended: mark expired + clear the
 *                  free DMFH flag (the audience view already stops sending at that point).
 *
 * Credit issuance reuses issueBalanceCredit with a deterministic key (xmas_credit_<id>)
 * so a re-run can never double-credit; every status transition is guarded.
 */

const RESEND_AFTER_DAYS = 7;
const CREDIT_AFTER_DAYS = 30;

// Scheduled-gift consent copy. Attestation is reused verbatim from the live flow (the
// buyer attested the recipient's number at checkout). Disclosure is scheduled-gift
// SPECIFIC so it matches THIS cadence (one reminder, then account credit), not the
// standard flow's "resend up to 3 times" language. DRAFT -- pending Iain review.
export const SG_CONSENT_VERSION = "scheduled-gift-2026-08-31-draft";
const SG_ATTESTATION: Record<string, (n: string) => string> = {
  en: (n) => `I confirm this is ${n}'s real phone number, that I have their permission to share it, and that I believe they'd want to receive this.`,
  es: (n) => `Confirmo que este es el número de teléfono real de ${n}, que tengo su permiso para compartirlo, y que creo que le gustaría recibir esto.`,
};
const SG_DISCLOSURE: Record<string, (n: string) => string> = {
  en: (n) => `${n} will get a text asking them to confirm, and we cannot start their gift without their own OK. In some cases a recipient may not meet the age or consent requirements for their country; if that happens, we will not text them and your payment converts to It's God, Yo! account credit instead. If they are texted but do not reply, we will send one reminder about a week later. If they still have not confirmed after about 30 days, the gift converts to account credit for the purchaser. We never keep texting someone who has not responded.`,
  es: (n) => `${n} recibirá un mensaje pidiéndole que confirme, y no podemos iniciar su regalo sin su propio consentimiento. En algunos casos, un destinatario puede no cumplir los requisitos de edad o consentimiento de su país; si eso ocurre, no le enviaremos mensajes y tu pago se convierte en crédito de cuenta de It's God, Yo!. Si se le envía el mensaje pero no responde, enviaremos un recordatorio aproximadamente una semana después. Si aún no ha confirmado después de unos 30 días, el regalo se convierte en crédito de cuenta para el comprador. Nunca seguimos enviando mensajes a alguien que no ha respondido.`,
};

// Verbatim reuse of the live confirmation-SMS copy, with the gifter lead-in (modes
// 1/2/3) that the live smsLeadIn defines -- a gift text should say who it is from.
function smsLeadIn(lang: "en" | "es", gifter: { honorific?: string | null; first?: string | null; relationship?: string | null }): string {
  const honorific = gifter.honorific?.trim();
  const relationship = gifter.relationship?.trim();
  const first = gifter.first?.trim();
  if (honorific) return [honorific, first].filter(Boolean).join(" ");
  if (relationship) return [lang === "es" ? "Tu" : "Your", relationship, first].filter(Boolean).join(" ");
  return lang === "es" ? "Alguien que se preocupa por ti" : "Someone who cares about you";
}
function giftConfirmationSms(lang: "en" | "es", recipientName: string, gifter: { honorific?: string | null; first?: string | null; relationship?: string | null }): string {
  const leadIn = smsLeadIn(lang, gifter);
  return lang === "es"
    ? `¡Hola ${recipientName}! ${leadIn} piensa que te vendrían bien unas Buenas Nuevas cada día. Responde SÍ para recibir mensajes diarios de It's God, Yo! Aplican tarifas de mensajes y datos. Responde STOP para cancelar, HELP para ayuda.`
    : `Hey ${recipientName}! ${leadIn} thought you could use some Good News every day. Reply YES to get daily texts from It's God, Yo! Msg & data rates may apply. Reply STOP to cancel, HELP for help.`;
}

export interface ReleaseSummary {
  ran_at: string;
  dry_run: boolean;
  released: number;
  age_gate_credited: number;
  resent: number;
  credited: number;
  deactivated: number;
  errors: string[];
}

interface PurchaseRow {
  id: string;
  purchaser_email: string;
  purchaser_first_name: string | null;
  stripe_customer_id: string;
  recipient_first_name: string | null;
  recipient_phone: string;
  recipient_birth_year: number | null;
  recipient_country_code: string | null;
  language: string | null;
  charged_amount_cents: number;
  gifter_first_name: string | null;
  gifter_honorific: string | null;
  gifter_relationship: string | null;
  consent_log_id: string | null;
}

const PURCHASE_COLS =
  "id, purchaser_email, purchaser_first_name, stripe_customer_id, recipient_first_name, recipient_phone, recipient_birth_year, recipient_country_code, language, charged_amount_cents, gifter_first_name, gifter_honorific, gifter_relationship, consent_log_id";

/** Issue the account credit for a purchase + stamp its credit fields. Idempotent via the
 *  Stripe key + the caller's status guard. Returns true if the credit + stamp succeeded. */
async function creditPurchase(admin: SupabaseClient, p: PurchaseRow, nowIso: string): Promise<boolean> {
  const { balanceTransactionId } = await issueBalanceCredit({
    customerId: p.stripe_customer_id,
    cents: p.charged_amount_cents,
    direction: "credit",
    currency: "usd",
    description: "It's God, Yo! Christmas gift account credit",
    idempotencyKey: `xmas_credit_${p.id}`,
    metadata: { purpose: "christmas_gift_2026", christmas_purchase_id: p.id },
  });
  const { error } = await admin
    .from("christmas_gift_2026_purchases")
    .update({
      status: "credited",
      credit_issued_at: nowIso,
      credit_amount_cents: p.charged_amount_cents,
      stripe_balance_transaction_id: balanceTransactionId,
      updated_at: nowIso,
    })
    .eq("id", p.id);
  if (error) throw new Error(`christmas_credit_stamp_failed ${p.id}: ${error.message}`);
  return true;
}

/**
 * Credit an unconfirmed scheduled-gift purchase (recipient never replied YES, or texted
 * STOP) and email the purchaser the generic non-confirmation message. Guarded so only one
 * caller credits (confirmation_sent is the only creditable state here); does NOT touch the
 * consent row, so the caller sets the right consent status (expired for no-reply, opted_out
 * for STOP). Shared by the day-30 pass and the twilioInbound STOP branch.
 */
export async function creditUnconfirmedChristmasGift(admin: SupabaseClient, purchaseId: string, nowMs: number): Promise<"credited" | "skipped"> {
  const nowIso = new Date(nowMs).toISOString();
  const { data } = await admin.from("christmas_gift_2026_purchases").select(PURCHASE_COLS).eq("id", purchaseId).eq("status", "confirmation_sent").maybeSingle();
  const p = data as PurchaseRow | null;
  if (!p) return "skipped";
  const { data: claimed } = await admin
    .from("christmas_gift_2026_purchases").update({ updated_at: nowIso })
    .eq("id", purchaseId).eq("status", "confirmation_sent").select("id");
  if (!claimed || claimed.length === 0) return "skipped";
  await creditPurchase(admin, p, nowIso);
  await sendChristmasGiftEmail(p.purchaser_email, nonConfirmationCreditEmail({
    purchaserFirstName: p.purchaser_first_name, recipientFirstName: p.recipient_first_name, amountCents: p.charged_amount_cents,
  }));
  return "credited";
}

export async function runChristmasGiftRelease(opts: { admin: SupabaseClient; nowMs: number; dryRun?: boolean }): Promise<ReleaseSummary> {
  const { admin, nowMs } = opts;
  const dryRun = !!opts.dryRun;
  const nowIso = new Date(nowMs).toISOString();
  const todayCT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date(nowMs)); // YYYY-MM-DD
  const resendBefore = new Date(nowMs - RESEND_AFTER_DAYS * 86400000).toISOString();
  const creditBefore = new Date(nowMs - CREDIT_AFTER_DAYS * 86400000).toISOString();
  const s: ReleaseSummary = { ran_at: nowIso, dry_run: dryRun, released: 0, age_gate_credited: 0, resent: 0, credited: 0, deactivated: 0, errors: [] };

  // ---------- Pass 1: RELEASE ----------
  const { data: due, error: dueErr } = await admin
    .from("christmas_gift_2026_purchases")
    .select(PURCHASE_COLS)
    .eq("status", "awaiting_release")
    .lte("release_at", todayCT);
  if (dueErr) throw new Error(`christmas_release_query_failed: ${dueErr.message}`);
  for (const p of (due ?? []) as PurchaseRow[]) {
    try {
      const lang = p.language === "es" ? "es" : "en";
      const phoneE164 = toE164(p.recipient_phone, (p.recipient_country_code ?? undefined) as Parameters<typeof toE164>[1]);
      const name = p.recipient_first_name?.trim() || "friend";

      // Age gate (once, at release). Only 'standard' proceeds; 'block' and 'enhanced'
      // (mechanism not built) both fail closed to an immediate credit.
      const gate = p.recipient_birth_year != null
        ? await evaluateAgeGate(phoneE164, p.recipient_birth_year)
        : null;
      const passed = gate?.decision === "standard";

      if (!passed) {
        if (dryRun) { s.age_gate_credited++; continue; }
        // guard: only credit a still-awaiting row
        const { data: claimed } = await admin
          .from("christmas_gift_2026_purchases")
          .update({ credit_skipped_reason: null, updated_at: nowIso })
          .eq("id", p.id).eq("status", "awaiting_release").select("id");
        if (!claimed || claimed.length === 0) continue;
        await creditPurchase(admin, p, nowIso);
        await sendChristmasGiftEmail(p.purchaser_email, ageGateFailureCreditEmail({
          purchaserFirstName: p.purchaser_first_name, recipientFirstName: p.recipient_first_name, amountCents: p.charged_amount_cents,
        }));
        s.age_gate_credited++;
        continue;
      }

      if (dryRun) { s.released++; continue; }

      // Create the consent row, then send. Only advance the purchase on a successful
      // send; on failure, roll back the consent row so the next run retries cleanly.
      const { data: consent, error: cErr } = await admin.from("consent_log").insert({
        recipient_phone: phoneE164,
        recipient_first_name: p.recipient_first_name,
        language: lang,
        consent_type: "scheduled_gift",
        attestation_text: SG_ATTESTATION[lang](name),
        attestation_text_version: SG_CONSENT_VERSION,
        disclosure_text: SG_DISCLOSURE[lang](name),
        disclosure_text_version: SG_CONSENT_VERSION,
        consent_status: "pending_confirmation",
        recipient_birth_year: p.recipient_birth_year,
        recipient_country_code: gate?.country ?? p.recipient_country_code,
        age_gate_decision: gate?.decision ?? null,
      }).select("id").single();
      if (cErr || !consent) throw new Error(`consent_insert_failed ${p.id}: ${cErr?.message ?? "no row"}`);
      const consentId = (consent as { id: string }).id;

      try {
        await sendSms(phoneE164, giftConfirmationSms(lang, name, { honorific: p.gifter_honorific, first: p.gifter_first_name, relationship: p.gifter_relationship }));
      } catch (sendErr) {
        // Roll back: delete the consent row, leave the purchase awaiting_release for retry.
        await admin.from("consent_log").delete().eq("id", consentId);
        throw new Error(`confirmation_send_failed ${p.id}: ${sendErr instanceof Error ? sendErr.message : "send"}`);
      }

      await admin.from("consent_log").update({ confirmation_sent_at: nowIso }).eq("id", consentId);
      await admin.from("christmas_gift_2026_purchases")
        .update({ status: "confirmation_sent", consent_log_id: consentId, confirmation_sent_at: nowIso, updated_at: nowIso })
        .eq("id", p.id).eq("status", "awaiting_release");
      s.released++;
    } catch (e) {
      s.errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  // ---------- Pass 2: RESEND (day 7) ----------
  const { data: toResend } = await admin
    .from("christmas_gift_2026_purchases")
    .select(PURCHASE_COLS)
    .eq("status", "confirmation_sent")
    .is("confirmation_resent_at", null)
    .lte("confirmation_sent_at", resendBefore);
  for (const p of (toResend ?? []) as PurchaseRow[]) {
    try {
      if (dryRun) { s.resent++; continue; }
      const lang = p.language === "es" ? "es" : "en";
      const phoneE164 = toE164(p.recipient_phone, (p.recipient_country_code ?? undefined) as Parameters<typeof toE164>[1]);
      const name = p.recipient_first_name?.trim() || "friend";
      await sendSms(phoneE164, giftConfirmationSms(lang, name, { honorific: p.gifter_honorific, first: p.gifter_first_name, relationship: p.gifter_relationship }));
      await admin.from("christmas_gift_2026_purchases")
        .update({ confirmation_resent_at: nowIso, updated_at: nowIso })
        .eq("id", p.id).eq("status", "confirmation_sent").is("confirmation_resent_at", null);
      s.resent++;
    } catch (e) {
      s.errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  // ---------- Pass 3: CREDIT (day 30, no confirmation) ----------
  const { data: toCredit } = await admin
    .from("christmas_gift_2026_purchases")
    .select(PURCHASE_COLS)
    .eq("status", "confirmation_sent")
    .lte("confirmation_sent_at", creditBefore);
  for (const p of (toCredit ?? []) as PurchaseRow[]) {
    try {
      if (dryRun) { s.credited++; continue; }
      const res = await creditUnconfirmedChristmasGift(admin, p.id, nowMs);
      if (res === "credited") {
        // No-reply expiry: mark the consent expired (STOP uses opted_out instead).
        if (p.consent_log_id) await admin.from("consent_log").update({ consent_status: "expired", updated_at: nowIso }).eq("id", p.consent_log_id);
        s.credited++;
      }
    } catch (e) {
      s.errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  // ---------- Pass 4: YEAR-END DEACTIVATION ----------
  if (!dryRun) {
    const { data: deact, error: deErr } = await admin
      .from("pending_signups")
      .update({ status: "expired", dm_addon: false, updated_at: nowIso })
      .eq("plan_key", "christmas_gift_2026").eq("status", "prepaid_active").lte("service_period_end", nowIso)
      .select("id");
    if (deErr) s.errors.push(`deactivate_failed: ${deErr.message}`);
    else s.deactivated = (deact ?? []).length;
  }

  return s;
}
