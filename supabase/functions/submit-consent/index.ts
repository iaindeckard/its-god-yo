import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// submit-consent: the website's delayed-billing handoff. Writes consent_log
// row(s) with the SERVICE ROLE (consent_log has no RLS policies -- locked to
// service role, which is why this is an Edge Function and not a client write),
// plus a pending_signups row holding the chosen plan + saved-but-uncharged
// payment method. NOTHING is billed here: the actual Stripe subscription is
// created later, only after the recipient replies YES via SMS (trial_end = 7
// days from that moment). Twilio is not wired up yet, so the confirmation SMS
// is STUBBED -- we log exactly what WOULD be sent rather than failing silently.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

// ---- Locked consent copy (versioned). Built server-side from templates so the
// stored record is authoritative and matches exactly what the UI must display.
const CONSENT_VERSION = "2026-07-20";
const ATTESTATION: Record<string, (name: string) => string> = {
  en: (n) => `I confirm this is ${n}'s real phone number, that I have their permission to share it, and that I believe they'd want to receive this.`,
  es: (n) => `Confirmo que este es el número de teléfono real de ${n}, que tengo su permiso para compartirlo, y que creo que le gustaría recibir esto.`,
};
const DISCLOSURE: Record<string, (name: string) => string> = {
  en: (n) => `${n} will get a text asking them to confirm — we can't sign anyone up without their own OK. If they don't reply within 48 hours, we'll let you know so you can resend the invite if you'd like. You can resend up to 3 times over 30 days; after that, you'd need to start over. We'll never resend automatically or keep texting someone who hasn't responded.`,
  es: (n) => `${n} recibirá un mensaje de texto pidiéndole que confirme — no podemos inscribir a nadie sin su propio consentimiento. Si no responde en 48 horas, te avisaremos para que puedas reenviar la invitación si lo deseas. Puedes reenviarla hasta 3 veces en un período de 30 días; después de eso, tendrías que empezar de nuevo. Nunca reenviaremos automáticamente ni seguiremos enviando mensajes a alguien que no ha respondido.`,
};

// Twilio stub. TODO(iain): replace with the LOCKED "DM from Him" SMS templates
// (per honorific / relationship / neither mode, EN+ES) once provided + Twilio
// creds. For now compose a clearly-marked placeholder and log it.
function stubConfirmationSms(lang: string, recipientName: string, kind: "primary" | "plus_one", gifter?: { honorific?: string; first?: string; relationship?: string }) {
  let who = "";
  if (kind === "plus_one" && gifter) {
    who = gifter.honorific?.trim() || [gifter.relationship, gifter.first].filter(Boolean).join(" ") || gifter.first || "someone who cares about you";
  }
  const body = lang === "es"
    ? `[STUB] Hola ${recipientName}, ${kind === "plus_one" ? `${who} ` : ""}te invitó a recibir un versículo diario de It's God, Yo. Responde SÍ para confirmar. (Plantilla oficial pendiente.)`
    : `[STUB] Hey ${recipientName}, ${kind === "plus_one" ? `${who} ` : ""}invited you to get a daily verse from It's God, Yo. Reply YES to confirm. (Official template pending.)`;
  console.log(`[submit-consent] SMS STUB (${kind}, ${lang}) -> ${recipientName}: ${body}`);
  return body;
}

interface PlusOne {
  gifter_first_name?: string;
  gifter_last_name?: string;
  gifter_honorific?: string;
  gifter_relationship?: string;
  recipient_first_name?: string;
  recipient_phone?: string;
  attestation_confirmed?: boolean;
}
interface Payload {
  language?: string;
  plan_key?: string;
  base_price_id?: string;
  group_teen_count?: number;
  dm_addon?: boolean;
  dm_addon_price_id?: string;
  referral_code?: string;
  referral_discount_applied?: boolean;
  purchaser_email?: string;
  teen?: { first_name?: string; phone?: string };
  plus_one?: PlusOne | null;
  stripe?: { customer_id?: string; setup_intent_id?: string; payment_method_id?: string };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  let p: Payload;
  try { p = await req.json(); } catch { return json(400, { error: "invalid_json_body" }); }

  const lang = p.language === "es" ? "es" : p.language === "en" ? "en" : null;
  if (!lang) return json(400, { error: "language must be 'en' or 'es'" });
  if (!p.teen?.first_name?.trim()) return json(400, { error: "teen.first_name is required" });
  if (!p.teen?.phone?.trim()) return json(400, { error: "teen.phone is required" });
  if (!p.plan_key || !p.base_price_id) return json(400, { error: "plan_key and base_price_id are required" });

  const optedInPlusOne = !!(p.plus_one && (p.plus_one.recipient_phone || p.plus_one.gifter_first_name));
  if (optedInPlusOne) {
    if (!p.plus_one!.gifter_first_name?.trim()) return json(400, { error: "plus_one.gifter_first_name is required when opting into the +1 add-on" });
    if (!p.plus_one!.recipient_phone?.trim()) return json(400, { error: "plus_one.recipient_phone is required when opting into the +1 add-on" });
    if (p.plus_one!.attestation_confirmed !== true) return json(400, { error: "plus_one.attestation_confirmed must be true before the +1 phone can be submitted" });
    const hasHonorific = !!p.plus_one!.gifter_honorific?.trim();
    const hasRelationship = !!p.plus_one!.gifter_relationship?.trim();
    if (!hasHonorific && !hasRelationship) return json(400, { error: "plus_one requires a gifter_relationship (or a gifter_honorific)" });
  }

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const teenName = p.teen!.first_name!.trim();
  const stubs: Array<{ kind: string; to: string; body: string }> = [];

  // 1) primary subscriber consent row (the teen)
  const teenSms = stubConfirmationSms(lang, teenName, "primary");
  stubs.push({ kind: "primary", to: p.teen!.phone!.trim(), body: teenSms });
  const { data: teenRow, error: teenErr } = await supa.from("consent_log").insert({
    recipient_phone: p.teen!.phone!.trim(),
    recipient_first_name: teenName,
    language: lang,
    consent_type: "primary_subscriber",
    attestation_text: ATTESTATION[lang](teenName),
    attestation_text_version: CONSENT_VERSION,
    disclosure_text: DISCLOSURE[lang](teenName),
    disclosure_text_version: CONSENT_VERSION,
    consent_status: "pending_confirmation",
    // confirmation_sent_at intentionally left null -- SMS is stubbed, not sent.
  }).select("id").single();
  if (teenErr) return json(500, { error: "failed_to_write_teen_consent", detail: teenErr.message });

  // 2) optional +1 recipient consent row
  let plusOneId: string | null = null;
  if (optedInPlusOne) {
    const po = p.plus_one!;
    const poName = po.recipient_first_name?.trim() || "your friend";
    const poSms = stubConfirmationSms(lang, poName, "plus_one", {
      honorific: po.gifter_honorific, first: po.gifter_first_name, relationship: po.gifter_relationship,
    });
    stubs.push({ kind: "plus_one", to: po.recipient_phone!.trim(), body: poSms });
    const { data: poRow, error: poErr } = await supa.from("consent_log").insert({
      recipient_phone: po.recipient_phone!.trim(),
      recipient_first_name: po.recipient_first_name?.trim() || null,
      language: lang,
      consent_type: "plus_one_gift",
      gifter_first_name: po.gifter_first_name?.trim() || null,
      gifter_last_name: po.gifter_last_name?.trim() || null,
      gifter_honorific: po.gifter_honorific?.trim() || null,
      gifter_relationship: po.gifter_relationship?.trim() || null,
      attestation_text: ATTESTATION[lang](poName),
      attestation_text_version: CONSENT_VERSION,
      disclosure_text: DISCLOSURE[lang](poName),
      disclosure_text_version: CONSENT_VERSION,
      consent_status: "pending_confirmation",
    }).select("id").single();
    if (poErr) return json(500, { error: "failed_to_write_plus_one_consent", detail: poErr.message });
    plusOneId = poRow.id;
  }

  // 3) pending signup: plan + saved (uncharged) payment method + consent links
  const { data: signup, error: signupErr } = await supa.from("pending_signups").insert({
    language: lang,
    plan_key: p.plan_key,
    base_price_id: p.base_price_id,
    group_teen_count: p.group_teen_count ?? null,
    dm_addon: !!p.dm_addon,
    dm_addon_price_id: p.dm_addon ? (p.dm_addon_price_id ?? null) : null,
    referral_code: p.referral_code?.trim() || null,
    referral_discount_applied: !!p.referral_discount_applied,
    purchaser_email: p.purchaser_email?.trim() || null,
    teen_consent_id: teenRow.id,
    plus_one_consent_id: plusOneId,
    stripe_customer_id: p.stripe?.customer_id ?? null,
    stripe_setup_intent_id: p.stripe?.setup_intent_id ?? null,
    stripe_payment_method_id: p.stripe?.payment_method_id ?? null,
    status: "awaiting_confirmation",
  }).select("id").single();
  if (signupErr) return json(500, { error: "failed_to_write_pending_signup", detail: signupErr.message });

  return json(200, {
    status: "submitted",
    message: lang === "es"
      ? `Le acabamos de enviar un mensaje a ${teenName} para confirmar. ¡En cuanto responda, todo estará listo!`
      : `We just texted ${teenName} to confirm — once they reply, you're all set!`,
    pending_signup_id: signup.id,
    teen_consent_id: teenRow.id,
    plus_one_consent_id: plusOneId,
    sms_stubbed: true,
    sms_would_send: stubs,
    note: "No charge yet. Subscription is created after SMS confirmation (trial_end = 7d from that moment). Twilio + locked DM-from-Him SMS templates still TODO.",
  });
});
