import "server-only";
import { getSupabaseAdmin } from "./supabaseAdmin";
import { createSubscriptionForPendingSignup } from "./createSubscription";
import { createFamilyBaseSubscription, reconcileFamilyExtraTeens } from "./familyBilling";
import { normalizePhone, classifyReply } from "./twilio";

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
    waiting: "Thanks — you're confirmed! We're just waiting on one more person before this starts.",
    optedOut: "You've been unsubscribed and won't receive messages. Reply START to opt back in.",
    help: "It's God, Yo! sends daily encouragement texts. Reply YES to confirm, STOP to cancel. Msg & data rates may apply.",
    notFound: "We couldn't find a pending confirmation for this number. If you signed up recently, please try again.",
    unknown: "Reply YES to confirm your daily texts from It's God, Yo!, or STOP to opt out.",
  },
  es: {
    allSet: "¡Todo listo! Empezarás a recibir Buenas Nuevas diarias de It's God, Yo! 🙏",
    waiting: "¡Gracias, quedaste confirmado! Solo esperamos a una persona más para comenzar.",
    optedOut: "Cancelaste tu suscripción y no recibirás mensajes. Responde START para volver a suscribirte.",
    help: "It's God, Yo! envía textos diarios de ánimo. Responde SÍ para confirmar, STOP para cancelar.",
    notFound: "No encontramos una confirmación pendiente para este número. Si te registraste hace poco, inténtalo de nuevo.",
    unknown: "Responde SÍ para confirmar tus textos diarios de It's God, Yo!, o STOP para cancelar.",
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

export async function processInboundReply(from: string, body: string): Promise<InboundResult> {
  const admin = getSupabaseAdmin();
  const intent = classifyReply(body);
  const fromNorm = normalizePhone(from);

  const { data: rows, error } = await admin
    .from("consent_log")
    .select("id, recipient_phone, consent_status, language, consent_type, pending_signup_id, welcome_token")
    .eq("consent_status", "pending_confirmation")
    .limit(500);
  if (error) throw new Error(`consent_lookup_failed: ${error.message}`);

  const candidates = ((rows ?? []) as ConsentRow[]).filter((r) => normalizePhone(r.recipient_phone) === fromNorm);

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

  if (!matched || (!signup && !familySignupId)) {
    if (intent === "stop") {
      await admin
        .from("consent_log")
        .update({ consent_status: "opted_out", opted_out_at: new Date().toISOString(), opt_out_method: "sms_stop", confirmation_reply_raw: body })
        .eq("recipient_phone", from);
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

  const result = await createSubscriptionForPendingSignup(signup!.id);
  if (result.status === "created")
    return { action: "confirmed_created", reply: allSetReply(lang, matched.welcome_token), pending_signup_id: signup!.id, subscription_id: result.subscription_id };
  if (result.status === "already_created")
    return { action: "already_created", reply: allSetReply(lang, matched.welcome_token), pending_signup_id: signup!.id, subscription_id: result.subscription_id };
  return { action: "blocked", reply: REPLY[lang].waiting, pending_signup_id: signup!.id, detail: result.detail || result.status };
}
