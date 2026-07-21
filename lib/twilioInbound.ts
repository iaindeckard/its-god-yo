import "server-only";
import { getSupabaseAdmin } from "./supabaseAdmin";
import { createSubscriptionForPendingSignup } from "./createSubscription";
import { normalizePhone, classifyReply } from "./twilio";

/**
 * Core inbound-reply logic for the Twilio "YES" handler, separated from the HTTP
 * route so it can be exercised directly. See app/api/twilio/inbound/route.ts.
 *
 * POLICY (confirm-all): a signup with a +1 requires BOTH the teen and the +1 to
 * reply YES before the subscription is created — the +1 add-on shouldn't bill
 * before that recipient consents. Flagged for review.
 */

const REPLY = {
  en: {
    confirmedAllDone: "You're all set! You'll start getting daily Good News from It's God, Yo! 🙏",
    confirmedWaiting: "Thanks — you're confirmed! We're just waiting on one more person before this starts.",
    optedOut: "You've been unsubscribed and won't receive messages. Reply START to opt back in.",
    help: "It's God, Yo! sends daily encouragement texts. Reply YES to confirm, STOP to cancel. Msg & data rates may apply.",
    notFound: "We couldn't find a pending confirmation for this number. If you signed up recently, please try again.",
    unknown: "Reply YES to confirm your daily texts from It's God, Yo!, or STOP to opt out.",
  },
  es: {
    confirmedAllDone: "¡Todo listo! Empezarás a recibir Buenas Nuevas diarias de It's God, Yo! 🙏",
    confirmedWaiting: "¡Gracias, quedaste confirmado! Solo esperamos a una persona más para comenzar.",
    optedOut: "Cancelaste tu suscripción y no recibirás mensajes. Responde START para volver a suscribirte.",
    help: "It's God, Yo! envía textos diarios de ánimo. Responde SÍ para confirmar, STOP para cancelar.",
    notFound: "No encontramos una confirmación pendiente para este número. Si te registraste hace poco, inténtalo de nuevo.",
    unknown: "Responde SÍ para confirmar tus textos diarios de It's God, Yo!, o STOP para cancelar.",
  },
} as const;

type Lang = "en" | "es";

export interface InboundResult {
  action:
    | "confirmed_created"
    | "confirmed_waiting"
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

export async function processInboundReply(from: string, body: string): Promise<InboundResult> {
  const admin = getSupabaseAdmin();
  const intent = classifyReply(body);
  const fromNorm = normalizePhone(from);

  const { data: rows, error } = await admin
    .from("consent_log")
    .select("id, recipient_phone, consent_status, language")
    .eq("consent_status", "pending_confirmation")
    .limit(500);
  if (error) throw new Error(`consent_lookup_failed: ${error.message}`);

  const candidates = (rows ?? []).filter((r) => normalizePhone(r.recipient_phone) === fromNorm);

  let matched: { id: string; language: string | null } | null = null;
  let signup: { id: string; teen_consent_id: string | null; plus_one_consent_id: string | null } | null = null;
  for (const c of candidates) {
    const { data: s } = await admin
      .from("pending_signups")
      .select("id, teen_consent_id, plus_one_consent_id")
      .or(`teen_consent_id.eq.${c.id},plus_one_consent_id.eq.${c.id}`)
      .eq("status", "awaiting_confirmation")
      .limit(1)
      .maybeSingle();
    if (s) {
      matched = { id: c.id, language: c.language };
      signup = s;
      break;
    }
  }

  const lang: Lang = matched?.language === "es" ? "es" : "en";

  if (intent === "help") return { action: "help", reply: REPLY[lang].help };

  if (!matched || !signup) {
    if (intent === "stop") {
      await admin
        .from("consent_log")
        .update({ consent_status: "opted_out", opted_out_at: new Date().toISOString(), opt_out_method: "sms_stop", confirmation_reply_raw: body })
        .eq("recipient_phone", from);
      return { action: "opted_out", reply: REPLY.en.optedOut };
    }
    return { action: "not_found", reply: REPLY.en.notFound };
  }

  if (intent === "stop") {
    await admin
      .from("consent_log")
      .update({
        consent_status: "opted_out",
        opted_out_at: new Date().toISOString(),
        opt_out_method: "sms_stop",
        confirmation_reply_received: true,
        confirmation_reply_at: new Date().toISOString(),
        confirmation_reply_raw: body,
      })
      .eq("id", matched.id);
    await admin.from("pending_signups").update({ status: "cancelled" }).eq("id", signup.id);
    return { action: "opted_out", reply: REPLY[lang].optedOut, pending_signup_id: signup.id };
  }

  if (intent !== "confirm") return { action: "unknown", reply: REPLY[lang].unknown };

  // YES: confirm this recipient's row.
  await admin
    .from("consent_log")
    .update({ consent_status: "confirmed", confirmation_reply_received: true, confirmation_reply_at: new Date().toISOString(), confirmation_reply_raw: body })
    .eq("id", matched.id);

  // All consent rows for the signup confirmed? (confirm-all policy)
  const consentIds = [signup.teen_consent_id, signup.plus_one_consent_id].filter(Boolean) as string[];
  const { data: states } = await admin.from("consent_log").select("consent_status").in("id", consentIds);
  const allConfirmed =
    (states ?? []).length === consentIds.length && (states ?? []).every((s) => s.consent_status === "confirmed");

  if (!allConfirmed) {
    return { action: "confirmed_waiting", reply: REPLY[lang].confirmedWaiting, pending_signup_id: signup.id };
  }

  const result = await createSubscriptionForPendingSignup(signup.id);
  if (result.status === "created")
    return { action: "confirmed_created", reply: REPLY[lang].confirmedAllDone, pending_signup_id: signup.id, subscription_id: result.subscription_id };
  if (result.status === "already_created")
    return { action: "already_created", reply: REPLY[lang].confirmedAllDone, pending_signup_id: signup.id, subscription_id: result.subscription_id };
  return { action: "blocked", reply: REPLY[lang].confirmedWaiting, pending_signup_id: signup.id, detail: result.detail || result.status };
}
