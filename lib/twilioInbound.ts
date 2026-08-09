import "server-only";
import { getSupabaseAdmin } from "./supabaseAdmin";
import { createSubscriptionForPendingSignup } from "./createSubscription";
import { createFamilyBaseSubscription, reconcileFamilyExtraTeens } from "./familyBilling";
import { classifyReply } from "./twilio";
import { toE164, phoneKey } from "./phone";
import { cancelSubscriptionForSignup, cancelFamilyBaseIfNoActiveTeens } from "./cancelSubscription";
import { setDmAddon } from "./dmAddon";

/**
 * Core inbound-reply logic for the Twilio "YES" handler.
 *
 * Individual / gift / +1 (confirm-all): the subscription is created once every
 * consent row on the purchase is confirmed.
 *
 * Family (per-teen): each teen has their own consent_log row + independent 7-day
 * trial. The base $99 subscription is created on the FIRST teen's YES; each
 * teen's YES sets their trial_ends_at (= now + 7d); the extra-teen $28 quantity
 * is reconciled (added at each teen's trial-end by the scheduled job — see
 * lib/familyBilling.ts). One teen opting out never cancels the whole family.
 */

const TRIAL_MS = 7 * 24 * 60 * 60 * 1000;

const REPLY = {
  en: {
    allSet: "You're all set! You'll start getting daily Good News from It's God, Yo! 🙏",
    waiting: "Thanks! You're confirmed! We're just waiting on one more person before this starts.",
    optedOut: "You've been unsubscribed and won't receive messages. Reply START to opt back in.",
    help: "It's God, Yo! sends daily encouragement texts. Reply YES to confirm, STOP to cancel. Add or remove DM from Him with DM ON / DM OFF. Msg & data rates may apply.",
    notFound: "We couldn't find a pending confirmation for this number. If you signed up recently, please try again.",
    unknown: "Reply YES to confirm your daily texts from It's God, Yo!, or STOP to opt out.",
    dmOn: "DM from Him is on 💛 Your daily verse will come as a personal note. Reply DM OFF anytime to turn it off.",
    dmOff: "DM from Him is off. You'll get your daily verse as usual. Reply DM ON anytime to turn it back on.",
    paymentIssue: "You're confirmed! 🙏 There was a hiccup charging the card, so we've emailed the person who set this up with a link to fix it. You'll start once that's sorted.",
  },
  es: {
    allSet: "¡Todo listo! Empezarás a recibir Buenas Nuevas diarias de It's God, Yo! 🙏",
    waiting: "¡Gracias, quedaste confirmado! Solo esperamos a una persona más para comenzar.",
    optedOut: "Cancelaste tu suscripción y no recibirás mensajes. Responde START para volver a suscribirte.",
    help: "It's God, Yo! envía textos diarios de ánimo. Responde SÍ para confirmar, STOP para cancelar.",
    notFound: "No encontramos una confirmación pendiente para este número. Si te registraste hace poco, inténtalo de nuevo.",
    unknown: "Responde SÍ para confirmar tus textos diarios de It's God, Yo!, o STOP para cancelar.",
    dmOn: "DM de Él está activado 💛 Tu versículo diario llegará como una nota personal. Responde DM OFF para desactivarlo.",
    dmOff: "DM de Él está desactivado. Recibirás tu versículo diario como siempre. Responde DM ON para reactivarlo.",
    paymentIssue: "¡Quedaste confirmado! 🙏 Hubo un problema al procesar la tarjeta, así que le enviamos un correo a la persona que lo configuró con un enlace para arreglarlo. Empezarás en cuanto se resuelva.",
  },
} as const;

type Lang = "en" | "es";

// Post-YES, once a recipient is fully confirmed, we append a link to the teen
// welcome page (Stage 2) so they can set their daily send time + timezone. The
// welcome_token is the row's own unguessable handle; nothing else gates the page.
const WELCOME_BASE = process.env.NEXT_PUBLIC_SITE_URL || "https://itsgodyo.com";
function allSetReply(lang: Lang, welcomeToken: string | null): string {
  const base = REPLY[lang].allSet;
  if (!welcomeToken) return base;
  const link = `${WELCOME_BASE}/welcome?c=${welcomeToken}`;
  return lang === "es"
    ? `${base} Elige tu hora diaria: ${link}`
    : `${base} Pick your daily time: ${link}`;
}

export interface InboundResult {
  action:
    | "confirmed_created"
    | "confirmed_waiting"
    | "confirmed_family"
    | "already_created"
    | "opted_out"
    | "not_found"
    | "help"
    | "unknown"
    | "dm_on"
    | "dm_off"
    | "payment_failed"
    | "blocked";
  reply: string;
  pending_signup_id?: string;
  subscription_id?: string;
  detail?: string;
}

interface ConsentRow {
  id: string;
  recipient_phone: string;
  consent_status: string;
  language: string | null;
  consent_type: string | null;
  pending_signup_id: string | null;
  welcome_token: string | null;
}

// A pending_signup with a live subscription (i.e. a CONFIRMED subscriber). Used
// to gate the confirmed-subscriber STOP path below. Excludes 'awaiting_confirmation'
// (still pending — handled by the pending path) and 'canceled' (already off).
const ACTIVE_SIGNUP_STATUSES = ["subscription_created", "active"];

interface ConfirmedMatch {
  consentId: string;
  consentType: string | null;
  signupId: string;
  language: string | null;
}

/**
 * Find a CONFIRMED consent row for `from` that is tied to an ACTIVE pending_signup
 * — i.e. a live subscriber (they are never in the pending_confirmation set). Match
 * is scale-safe: a targeted exact `.eq` on the canonical E.164 form first, then a
 * bounded phoneKey JS-scan fallback for any legacy rows stored non-E.164.
 *
 * SCALE FOLLOW-UP: add a normalized, indexed `phone_key` column (+ backfill) so the
 * fallback scan can be dropped. Deferred per Iain — no column / no backfill now.
 */
async function findConfirmedActiveSubscriber(
  admin: ReturnType<typeof getSupabaseAdmin>,
  fromE164: string,
  fromKey: string,
): Promise<ConfirmedMatch | null> {
  type Row = { id: string; recipient_phone: string; consent_type: string | null; pending_signup_id: string | null; language: string | null };

  // Primary: targeted exact-match on canonical E.164 (indexable, cheap).
  const { data: exact } = await admin
    .from("consent_log")
    .select("id, recipient_phone, consent_type, pending_signup_id, language")
    .eq("recipient_phone", fromE164)
    .eq("consent_status", "confirmed")
    .limit(50);
  let rows = (exact ?? []) as Row[];

  // Fallback: bounded phoneKey scan for legacy non-E.164 rows only.
  if (rows.length === 0) {
    const { data: scan } = await admin
      .from("consent_log")
      .select("id, recipient_phone, consent_type, pending_signup_id, language")
      .eq("consent_status", "confirmed")
      .limit(1000);
    rows = ((scan ?? []) as Row[]).filter((r) => phoneKey(r.recipient_phone) === fromKey);
  }

  for (const r of rows) {
    if (!r.pending_signup_id) continue;
    const { data: ps } = await admin
      .from("pending_signups")
      .select("id, status")
      .eq("id", r.pending_signup_id)
      .in("status", ACTIVE_SIGNUP_STATUSES)
      .maybeSingle();
    if (ps) return { consentId: r.id, consentType: r.consent_type, signupId: ps.id, language: r.language };
  }
  return null;
}

export async function processInboundReply(from: string, body: string): Promise<InboundResult> {
  const admin = getSupabaseAdmin();
  const intent = classifyReply(body);
  // Canonical E.164 for exact matching; phoneKey (digits-only last-10) for tolerant
  // matching against legacy / prefix-divergent rows.
  const fromE164 = toE164(from);
  const fromKey = phoneKey(from);

  const { data: rows, error } = await admin
    .from("consent_log")
    .select("id, recipient_phone, consent_status, language, consent_type, pending_signup_id, welcome_token")
    .eq("consent_status", "pending_confirmation")
    .limit(500);
  if (error) throw new Error(`consent_lookup_failed: ${error.message}`);

  const candidates = ((rows ?? []) as ConsentRow[]).filter((r) => phoneKey(r.recipient_phone) === fromKey);

  let matched: { id: string; language: string | null; welcome_token: string | null } | null = null;
  let signup: { id: string; teen_consent_id: string | null; plus_one_consent_id: string | null } | null = null;
  let familySignupId: string | null = null;
  let familyHasSub = false;

  for (const c of candidates) {
    if (c.consent_type === "family_teen" && c.pending_signup_id) {
      const { data: fs } = await admin
        .from("pending_signups")
        .select("id, stripe_subscription_id, status")
        .eq("id", c.pending_signup_id)
        .in("status", ["awaiting_confirmation", "subscription_created"])
        .maybeSingle();
      if (fs) {
        matched = { id: c.id, language: c.language, welcome_token: c.welcome_token };
        familySignupId = fs.id;
        familyHasSub = !!fs.stripe_subscription_id;
        break;
      }
    } else {
      const { data: s } = await admin
        .from("pending_signups")
        .select("id, teen_consent_id, plus_one_consent_id")
        .or(`teen_consent_id.eq.${c.id},plus_one_consent_id.eq.${c.id}`)
        .eq("status", "awaiting_confirmation")
        .limit(1)
        .maybeSingle();
      if (s) {
        matched = { id: c.id, language: c.language, welcome_token: c.welcome_token };
        signup = s;
        break;
      }
    }
  }

  const lang: Lang = matched?.language === "es" ? "es" : "en";

  if (intent === "help") return { action: "help", reply: REPLY[lang].help };

  // ---------- DM from Him add-on toggle (DM ON / DM OFF) ----------
  // Toggles ONLY the add-on — never the base subscription (STOP does that). Works
  // for a confirmed active subscriber OR a still-pending signup (flag applied when
  // their subscription is later created).
  if (intent === "dm_on" || intent === "dm_off") {
    const on = intent === "dm_on";
    const confirmed = await findConfirmedActiveSubscriber(admin, fromE164, fromKey);
    const targetSignupId = confirmed?.signupId ?? signup?.id ?? familySignupId ?? null;
    const dlang: Lang = (confirmed?.language ?? matched?.language) === "es" ? "es" : "en";
    if (!targetSignupId) return { action: "not_found", reply: REPLY[dlang].notFound };
    await setDmAddon(targetSignupId, on);
    // If this DM ON is answering the day-14-21 upsell, record the conversion
    // (best-effort, only flips a 'sent' row -> 'accepted'; never blocks the reply).
    if (on) {
      await admin.from("dm_upsell_log").update({ status: "accepted", updated_at: new Date().toISOString() })
        .eq("pending_signup_id", targetSignupId).eq("status", "sent")
        .then(undefined, (e) => console.error("[dm-upsell] accept_stamp_failed:", e instanceof Error ? e.message : e));
    }
    return { action: on ? "dm_on" : "dm_off", reply: on ? REPLY[dlang].dmOn : REPLY[dlang].dmOff, pending_signup_id: targetSignupId };
  }

  if (!matched || (!signup && !familySignupId)) {
    if (intent === "stop") {
      // FIRST-CLASS confirmed-subscriber STOP. A confirmed, active subscriber is
      // never in the pending_confirmation candidate set above, so historically
      // their STOP fell here and only touched consent_log (via a RAW recipient_phone
      // .eq) — never canceling Stripe or updating pending_signups. That let BILLING
      // CONTINUE after opt-out. Now we cancel for real.
      const confirmed = await findConfirmedActiveSubscriber(admin, fromE164, fromKey);
      if (confirmed) {
        const clang: Lang = confirmed.language === "es" ? "es" : "en";
        const nowIso = new Date().toISOString();
        // Opt this recipient's own consent row out (by id).
        await admin
          .from("consent_log")
          .update({ consent_status: "opted_out", opted_out_at: nowIso, opt_out_method: "sms_stop", confirmation_reply_raw: body })
          .eq("id", confirmed.consentId);

        if (confirmed.consentType === "family_teen") {
          // One teen opting out never cancels the whole family: drop THEIR $28
          // extra-teen line, then cancel the base ONLY if no confirmed teen remains.
          await reconcileFamilyExtraTeens(confirmed.signupId);
          await cancelFamilyBaseIfNoActiveTeens(confirmed.signupId);
        } else {
          // Individual / gift: cancel the subscription outright.
          await cancelSubscriptionForSignup(confirmed.signupId, "sms_stop");
        }
        return { action: "opted_out", reply: REPLY[clang].optedOut, pending_signup_id: confirmed.signupId };
      }

      // Defensive safety net: a STOP from a known-but-otherwise-unmatched phone
      // still records opt-out. Matched by phoneKey (tolerant), NEVER a raw .eq, so
      // legacy / prefix-divergent rows are still opted out.
      const { data: knownRows } = await admin
        .from("consent_log")
        .select("id, recipient_phone")
        .neq("consent_status", "opted_out")
        .limit(1000);
      const optOutIds = ((knownRows ?? []) as Array<{ id: string; recipient_phone: string }>)
        .filter((r) => phoneKey(r.recipient_phone) === fromKey)
        .map((r) => r.id);
      if (optOutIds.length) {
        await admin
          .from("consent_log")
          .update({ consent_status: "opted_out", opted_out_at: new Date().toISOString(), opt_out_method: "sms_stop", confirmation_reply_raw: body })
          .in("id", optOutIds);
      }
      return { action: "opted_out", reply: REPLY.en.optedOut };
    }
    return { action: "not_found", reply: REPLY.en.notFound };
  }

  // ---------- FAMILY teen ----------
  if (familySignupId) {
    if (intent === "stop") {
      await admin
        .from("consent_log")
        .update({ consent_status: "opted_out", opted_out_at: new Date().toISOString(), opt_out_method: "sms_stop", confirmation_reply_received: true, confirmation_reply_at: new Date().toISOString(), confirmation_reply_raw: body })
        .eq("id", matched.id);
      if (familyHasSub) await reconcileFamilyExtraTeens(familySignupId); // drop their $28 if it was billed
      return { action: "opted_out", reply: REPLY[lang].optedOut, pending_signup_id: familySignupId };
    }
    if (intent !== "confirm") return { action: "unknown", reply: REPLY[lang].unknown };

    // YES: confirm this teen + start THEIR 7-day trial clock.
    await admin
      .from("consent_log")
      .update({
        consent_status: "confirmed",
        confirmation_reply_received: true,
        confirmation_reply_at: new Date().toISOString(),
        confirmation_reply_raw: body,
        trial_ends_at: new Date(Date.now() + TRIAL_MS).toISOString(),
      })
      .eq("id", matched.id);

    let subId: string | undefined;
    if (!familyHasSub) {
      const r = await createFamilyBaseSubscription(familySignupId); // first teen -> create base sub (7-day trial)
      subId = r.subscription_id;
    }
    await reconcileFamilyExtraTeens(familySignupId); // idempotent; picks up any already-elapsed extra teens
    return { action: "confirmed_family", reply: allSetReply(lang, matched.welcome_token), pending_signup_id: familySignupId, subscription_id: subId };
  }

  // ---------- Individual / gift / +1 (confirm-all) ----------
  if (intent === "stop") {
    await admin
      .from("consent_log")
      .update({ consent_status: "opted_out", opted_out_at: new Date().toISOString(), opt_out_method: "sms_stop", confirmation_reply_received: true, confirmation_reply_at: new Date().toISOString(), confirmation_reply_raw: body })
      .eq("id", matched.id);
    await admin.from("pending_signups").update({ status: "canceled" }).eq("id", signup!.id);
    return { action: "opted_out", reply: REPLY[lang].optedOut, pending_signup_id: signup!.id };
  }
  if (intent !== "confirm") return { action: "unknown", reply: REPLY[lang].unknown };

  await admin
    .from("consent_log")
    .update({ consent_status: "confirmed", confirmation_reply_received: true, confirmation_reply_at: new Date().toISOString(), confirmation_reply_raw: body })
    .eq("id", matched.id);

  const consentIds = [signup!.teen_consent_id, signup!.plus_one_consent_id].filter(Boolean) as string[];
  const { data: states } = await admin.from("consent_log").select("consent_status").in("id", consentIds);
  const allConfirmed = (states ?? []).length === consentIds.length && (states ?? []).every((s) => s.consent_status === "confirmed");

  if (!allConfirmed) return { action: "confirmed_waiting", reply: REPLY[lang].waiting, pending_signup_id: signup!.id };

  // Confirmation creates the subscription with the standard 7-day trial (no
  // immediate charge).
  const result = await createSubscriptionForPendingSignup(signup!.id);
  if (result.status === "created")
    return { action: "confirmed_created", reply: allSetReply(lang, matched.welcome_token), pending_signup_id: signup!.id, subscription_id: result.subscription_id };
  if (result.status === "already_created")
    return { action: "already_created", reply: allSetReply(lang, matched.welcome_token), pending_signup_id: signup!.id, subscription_id: result.subscription_id };
  return { action: "blocked", reply: REPLY[lang].waiting, pending_signup_id: signup!.id, detail: result.detail || result.status };
}
