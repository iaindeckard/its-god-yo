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

// ---- Locked "DM from Him" confirmation-SMS templates (EN/ES), version-pinned
// with the consent copy above. The lead-in is the SUBJECT of "thought you could
// use..." and has three modes, in priority order:
//   1) honorific present  -> "[Honorific] [Gifter first]"      e.g. "Fr. Michael"
//   2) relationship only  -> "Your [Relationship] [Gifter first]" e.g. "Your Grandmother Linda"
//   3) neither            -> "Someone who cares about you"
// The primary subscriber carries no gifter data, so it always resolves to mode 3
// (by design -- the locked spec's "neither" fallback covers exactly this case).
// STOP/HELP stay in English in BOTH languages (carrier keyword requirement, not
// a translation gap). Twilio is still not wired, so we compose the real body and
// LOG it (stubbed delivery) rather than sending -- but the copy is now final.
function smsLeadIn(lang: "en" | "es", gifter?: { honorific?: string; first?: string; relationship?: string }): string {
  const honorific = gifter?.honorific?.trim();
  const relationship = gifter?.relationship?.trim();
  const first = gifter?.first?.trim();
  if (honorific) return [honorific, first].filter(Boolean).join(" ");           // mode 1
  if (relationship) {                                                            // mode 2
    const your = lang === "es" ? "Tu" : "Your";
    return [your, relationship, first].filter(Boolean).join(" ");
  }
  return lang === "es" ? "Alguien que se preocupa por ti" : "Someone who cares about you"; // mode 3
}
function confirmationSms(lang: "en" | "es", recipientName: string, kind: "primary" | "plus_one", gifter?: { honorific?: string; first?: string; relationship?: string }): string {
  const leadIn = smsLeadIn(lang, kind === "plus_one" ? gifter : undefined);
  const body = lang === "es"
    ? `¡Hola ${recipientName}! ${leadIn} piensa que te vendrían bien unas Buenas Nuevas cada día. Responde SÍ para recibir mensajes diarios de It's God, Yo! Aplican tarifas de mensajes y datos. Responde STOP para cancelar, HELP para ayuda.`
    : `Hey ${recipientName}! ${leadIn} thought you could use some Good News every day. Reply YES to get daily texts from It's God, Yo! Msg & data rates may apply. Reply STOP to cancel, HELP for help.`;
  console.log(`[submit-consent] SMS (${kind}, ${lang}, delivery stubbed) -> ${recipientName}: ${body}`);
  return body;
}

interface PlusOne {
  gifter_first_name?: string;
  gifter_last_name?: string;
  gifter_honorific?: string;
  gifter_relationship?: string;
  recipient_first_name?: string;
  recipient_phone?: string;
  recipient_birth_year?: number;
  attestation_confirmed?: boolean;
  enhanced_consent_ack?: boolean;
}
interface Payload {
  language?: string;
  theme_track?: string;
  plan_key?: string;
  base_price_id?: string;
  group_teen_count?: number;
  dm_addon?: boolean;
  dm_addon_price_id?: string;
  referral_code?: string;
  referral_discount_applied?: boolean;
  promo_code?: string;
  promo_promotion_code_id?: string;
  purchaser_email?: string;
  teen?: { first_name?: string; phone?: string; birth_year?: number; enhanced_consent_ack?: boolean };
  plus_one?: PlusOne | null;
  family_teens?: Array<{ first_name?: string; phone?: string; birth_year?: number; enhanced_consent_ack?: boolean }>;
  stripe?: { customer_id?: string; setup_intent_id?: string; payment_method_id?: string };
}

// ============================ AGE-CONSENT GATE ============================
// Fail-safe by default. There is NO single hardcoded age. The self-consent age
// for each country is read from age_consent_thresholds (the single source of
// truth). Until a country's row is attorney_confirmed, anyone computed under the
// strictest plausible default (16, the GDPR ceiling) is BLOCKED in that country.
// This is the whole point: nothing legally risky can complete until counsel
// confirms a country's real number. Enforced HERE (the one non-bypassable write
// path), not just in the UI.
const FAILSAFE_MIN_AGE = 16;

// E.164 calling code -> ISO country. +1 (NANP) is treated as US for the launch;
// other NANP countries aren't launch markets and fail safe anyway (no confirmed
// row => under-16 blocked). Unknown prefix => null => fail-safe.
const CALLING_CODE_TO_ISO: Record<string, string> = {
  "1": "US", "52": "MX",
  "44": "GB", "353": "IE", "49": "DE", "33": "FR", "34": "ES", "39": "IT", "351": "PT",
  "31": "NL", "32": "BE", "41": "CH", "43": "AT", "46": "SE", "45": "DK", "47": "NO",
  "358": "FI", "48": "PL", "55": "BR", "54": "AR", "57": "CO", "56": "CL", "51": "PE",
  "61": "AU", "64": "NZ", "91": "IN", "81": "JP", "82": "KR", "86": "CN", "63": "PH",
};

function parseCountryFromPhone(phone: string): string | null {
  const cleaned = phone.replace(/[^\d+]/g, "");
  if (!cleaned.startsWith("+")) return null; // need E.164 to determine country reliably
  const num = cleaned.slice(1);
  for (const len of [3, 2, 1]) {
    const code = num.slice(0, len);
    if (CALLING_CODE_TO_ISO[code]) return CALLING_CODE_TO_ISO[code];
  }
  return null;
}

type GateDecision = "standard" | "enhanced" | "block";
interface GateResult {
  decision: GateDecision;
  country: string | null;
  age: number;
  minAge: number;
  confirmed: boolean;
  reason: string;
}

function evaluateAgeGate(
  phone: string,
  birthYear: number,
  currentYear: number,
  thresholds: Map<string, { min: number; confirmed: boolean }>,
): GateResult {
  const country = parseCountryFromPhone(phone);
  const age = currentYear - birthYear;
  const row = country ? thresholds.get(country) : undefined;
  const confirmed = row?.confirmed ?? false;
  const minAge = row?.min ?? FAILSAFE_MIN_AGE;

  if (!confirmed) {
    // Unconfirmed / unknown country: fail safe. Block under the strictest
    // plausible default; at/above it, standard attestation is safe because no
    // jurisdiction's self-consent line exceeds 16.
    if (age < FAILSAFE_MIN_AGE) {
      return { decision: "block", country, age, minAge: FAILSAFE_MIN_AGE, confirmed, reason: "under_failsafe_unconfirmed_country" };
    }
    return { decision: "standard", country, age, minAge: FAILSAFE_MIN_AGE, confirmed, reason: "at_or_above_failsafe" };
  }
  // Attorney-confirmed country: use its real threshold (which may be below 16).
  if (age >= minAge) {
    return { decision: "standard", country, age, minAge, confirmed, reason: "at_or_above_confirmed_threshold" };
  }
  return { decision: "enhanced", country, age, minAge, confirmed, reason: "below_confirmed_threshold" };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  let p: Payload;
  try { p = await req.json(); } catch { return json(400, { error: "invalid_json_body" }); }

  const lang = p.language === "es" ? "es" : p.language === "en" ? "en" : null;
  if (!lang) return json(400, { error: "language must be 'en' or 'es'" });

  // ---------------- FAMILY plan: N teens, each own consent row + confirmation ----------------
  if (p.plan_key === "family" && Array.isArray(p.family_teens) && p.family_teens.length >= 2) {
    const teens = p.family_teens;
    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    if (!p.base_price_id) return json(400, { error: "base_price_id is required" });
    const yr = new Date().getFullYear();
    const validYear = (y: unknown) => (typeof y === "number" && Number.isInteger(y) && y >= yr - 120 && y <= yr ? (y as number) : null);
    for (let i = 0; i < teens.length; i++) {
      if (!teens[i]?.first_name?.trim()) return json(400, { error: `family_teens[${i}].first_name is required` });
      if (!teens[i]?.phone?.trim()) return json(400, { error: `family_teens[${i}].phone is required` });
      if (validYear(teens[i]?.birth_year) === null) return json(400, { error: `family_teens[${i}].birth_year is required (4-digit year)` });
    }
    const { data: thrRows, error: thrErr } = await supa.from("age_consent_thresholds").select("country_code, minimum_age_for_self_consent, attorney_confirmed");
    if (thrErr) return json(500, { error: "failed_to_read_age_thresholds", detail: thrErr.message });
    const thresholds = new Map<string, { min: number; confirmed: boolean }>();
    for (const r of thrRows ?? []) thresholds.set(r.country_code, { min: r.minimum_age_for_self_consent, confirmed: r.attorney_confirmed });

    const consentIds: string[] = [];
    const stubs: Array<{ to: string; body: string; cid: string }> = [];
    for (let i = 0; i < teens.length; i++) {
      const name = teens[i].first_name!.trim();
      const gate = evaluateAgeGate(teens[i].phone!.trim(), teens[i].birth_year as number, yr, thresholds);
      if (gate.decision === "block") return json(403, { error: "age_consent_blocked", who: `family_teens[${i}]`, country: gate.country, computed_age: gate.age, min_age: gate.minAge });
      if (gate.decision === "enhanced" && teens[i].enhanced_consent_ack !== true) return json(422, { error: "enhanced_consent_required", who: `family_teens[${i}]`, country: gate.country, threshold: gate.minAge });
      const sms = confirmationSms(lang, name, "primary");
      const { data: row, error: cErr } = await supa.from("consent_log").insert({
        recipient_phone: teens[i].phone!.trim(), recipient_first_name: name, language: lang,
        consent_type: "family_teen", teen_index: i + 1,
        attestation_text: ATTESTATION[lang](name), attestation_text_version: CONSENT_VERSION,
        disclosure_text: DISCLOSURE[lang](name), disclosure_text_version: CONSENT_VERSION,
        consent_status: "pending_confirmation", recipient_birth_year: teens[i].birth_year,
        recipient_country_code: gate.country, age_gate_decision: gate.decision === "enhanced" ? "enhanced_pending_mechanism" : "standard",
      }).select("id").single();
      if (cErr) return json(500, { error: "failed_to_write_family_consent", detail: cErr.message });
      consentIds.push(row.id);
      stubs.push({ to: teens[i].phone!.trim(), body: sms, cid: row.id });
    }
    const { data: signup, error: sErr } = await supa.from("pending_signups").insert({
      language: lang, theme_track: p.theme_track?.trim() || "general", plan_key: "family", base_price_id: p.base_price_id, dm_addon: false,
      referral_code: p.referral_code?.trim() || null, referral_discount_applied: !!p.referral_discount_applied,
      promo_code: p.promo_code?.trim() || null, promo_promotion_code_id: p.promo_promotion_code_id?.trim() || null,
      purchaser_email: p.purchaser_email?.trim() || null, teen_consent_id: consentIds[0], plus_one_consent_id: null,
      stripe_customer_id: p.stripe?.customer_id ?? null, stripe_setup_intent_id: p.stripe?.setup_intent_id ?? null,
      stripe_payment_method_id: p.stripe?.payment_method_id ?? null, status: "awaiting_confirmation",
    }).select("id").single();
    if (sErr) return json(500, { error: "failed_to_write_family_signup", detail: sErr.message });
    await supa.from("consent_log").update({ pending_signup_id: signup.id }).in("id", consentIds);

    const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID"); const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN"); const twilioFrom = Deno.env.get("TWILIO_FROM_NUMBER");
    let sent = 0; const sendErrors: Array<{ to: string; error: string }> = [];
    if (twilioSid && twilioToken && twilioFrom) {
      for (const s of stubs) {
        try {
          const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, { method: "POST", headers: { Authorization: "Basic " + btoa(`${twilioSid}:${twilioToken}`), "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ From: twilioFrom, To: s.to, Body: s.body }).toString() });
          if (!resp.ok) { sendErrors.push({ to: s.to, error: `${resp.status} ${(await resp.text()).slice(0, 120)}` }); continue; }
          sent++; await supa.from("consent_log").update({ confirmation_sent_at: new Date().toISOString() }).eq("id", s.cid);
        } catch (e) { sendErrors.push({ to: s.to, error: e instanceof Error ? e.message : "send_failed" }); }
      }
    }
    return json(200, {
      status: "submitted", plan: "family", pending_signup_id: signup.id, teen_consent_ids: consentIds, teen_count: teens.length,
      sms_stubbed: sent === 0, sms_sent_count: sent,
      sms_would_send: sent === 0 ? stubs.map((s) => ({ to: s.to, body: s.body })) : undefined,
      sms_send_errors: sendErrors.length ? sendErrors : undefined,
      message: lang === "es"
        ? "Le enviamos un mensaje a cada joven para confirmar. Cada uno debe responder SÍ por su cuenta."
        : "We texted each teen to confirm — each one replies YES on their own.",
      note: "Family: each teen has their own 7-day trial from their own YES; the $28 extra-teen line is added at each teen's trial-end. Unconfirmed teens are billed $0.",
    });
  }

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

  // ---------------- AGE-CONSENT GATE (enforced before ANY writes) ----------------
  const currentYear = new Date().getFullYear();
  const validBirthYear = (y: unknown): number | null =>
    typeof y === "number" && Number.isInteger(y) && y >= currentYear - 120 && y <= currentYear ? y : null;

  const teenBirthYear = validBirthYear(p.teen?.birth_year);
  if (teenBirthYear === null) return json(400, { error: "teen.birth_year is required (a 4-digit year)" });
  let poBirthYear: number | null = null;
  if (optedInPlusOne) {
    poBirthYear = validBirthYear(p.plus_one!.recipient_birth_year);
    if (poBirthYear === null) return json(400, { error: "plus_one.recipient_birth_year is required (a 4-digit year)" });
  }

  const { data: thrRows, error: thrErr } = await supa
    .from("age_consent_thresholds")
    .select("country_code, minimum_age_for_self_consent, attorney_confirmed");
  if (thrErr) return json(500, { error: "failed_to_read_age_thresholds", detail: thrErr.message });
  const thresholds = new Map<string, { min: number; confirmed: boolean }>();
  for (const r of thrRows ?? []) thresholds.set(r.country_code, { min: r.minimum_age_for_self_consent, confirmed: r.attorney_confirmed });

  const teenGate = evaluateAgeGate(p.teen!.phone!.trim(), teenBirthYear, currentYear, thresholds);
  const poGate = optedInPlusOne ? evaluateAgeGate(p.plus_one!.recipient_phone!.trim(), poBirthYear!, currentYear, thresholds) : null;

  const gates: Array<{ who: string; gate: GateResult; ack: boolean }> = [
    { who: "teen", gate: teenGate, ack: p.teen?.enhanced_consent_ack === true },
  ];
  if (poGate) gates.push({ who: "plus_one", gate: poGate, ack: p.plus_one?.enhanced_consent_ack === true });

  for (const g of gates) {
    if (g.gate.decision === "block") {
      return json(403, {
        error: "age_consent_blocked",
        who: g.who,
        country: g.gate.country,
        computed_age: g.gate.age,
        min_age: g.gate.minAge,
        message: g.gate.country
          ? `Sign-ups for people under ${g.gate.minAge} aren't available in ${g.gate.country} yet.`
          : `We couldn't confirm the country for this number, so sign-ups for people under ${g.gate.minAge} aren't available.`,
        detail: g.gate.reason,
      });
    }
    if (g.gate.decision === "enhanced" && !g.ack) {
      // Attorney-confirmed country, recipient below its threshold: the standard
      // purchaser attestation is NOT sufficient. Require the enhanced-consent
      // shell to have been used. The actual mechanism is TODO pending counsel.
      return json(422, {
        error: "enhanced_consent_required",
        who: g.who,
        country: g.gate.country,
        computed_age: g.gate.age,
        threshold: g.gate.minAge,
        message: "This recipient is below the confirmed self-consent age for their country. Standard attestation is not sufficient — TODO: pending confirmed consent mechanism from counsel.",
      });
    }
  }
  const teenGateDecision = teenGate.decision === "enhanced" ? "enhanced_pending_mechanism" : "standard";
  const poGateDecision = poGate ? (poGate.decision === "enhanced" ? "enhanced_pending_mechanism" : "standard") : null;

  const teenName = p.teen!.first_name!.trim();
  const stubs: Array<{ kind: string; to: string; body: string }> = [];

  // 1) primary subscriber consent row (the teen)
  const teenSms = confirmationSms(lang, teenName, "primary");
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
    recipient_birth_year: teenBirthYear,
    recipient_country_code: teenGate.country,
    age_gate_decision: teenGateDecision,
    // confirmation_sent_at intentionally left null -- SMS is stubbed, not sent.
  }).select("id").single();
  if (teenErr) return json(500, { error: "failed_to_write_teen_consent", detail: teenErr.message });

  // 2) optional +1 recipient consent row
  let plusOneId: string | null = null;
  if (optedInPlusOne) {
    const po = p.plus_one!;
    const poName = po.recipient_first_name?.trim() || "your friend";
    const poSms = confirmationSms(lang, poName, "plus_one", {
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
      recipient_birth_year: poBirthYear,
      recipient_country_code: poGate!.country,
      age_gate_decision: poGateDecision,
    }).select("id").single();
    if (poErr) return json(500, { error: "failed_to_write_plus_one_consent", detail: poErr.message });
    plusOneId = poRow.id;
  }

  // 3) pending signup: plan + saved (uncharged) payment method + consent links
  const { data: signup, error: signupErr } = await supa.from("pending_signups").insert({
    language: lang,
    theme_track: p.theme_track?.trim() || "general",
    plan_key: p.plan_key,
    base_price_id: p.base_price_id,
    group_teen_count: p.group_teen_count ?? null,
    dm_addon: !!p.dm_addon,
    dm_addon_price_id: p.dm_addon ? (p.dm_addon_price_id ?? null) : null,
    referral_code: p.referral_code?.trim() || null,
    referral_discount_applied: !!p.referral_discount_applied,
    promo_code: p.promo_code?.trim() || null,
    promo_promotion_code_id: p.promo_promotion_code_id?.trim() || null,
    purchaser_email: p.purchaser_email?.trim() || null,
    teen_consent_id: teenRow.id,
    plus_one_consent_id: plusOneId,
    stripe_customer_id: p.stripe?.customer_id ?? null,
    stripe_setup_intent_id: p.stripe?.setup_intent_id ?? null,
    stripe_payment_method_id: p.stripe?.payment_method_id ?? null,
    status: "awaiting_confirmation",
  }).select("id").single();
  if (signupErr) return json(500, { error: "failed_to_write_pending_signup", detail: signupErr.message });

  // 4) Deliver the confirmation SMS(es) via Twilio IF credentials are present.
  //    Until the Twilio account is verified/credentialed this is a no-op and we
  //    keep the stub behavior (bodies composed + logged above, not sent).
  const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const twilioFrom = Deno.env.get("TWILIO_FROM_NUMBER");
  const consentIdByKind: Record<string, string> = { primary: teenRow.id, ...(plusOneId ? { plus_one: plusOneId } : {}) };
  let sentCount = 0;
  const sendErrors: Array<{ to: string; error: string }> = [];
  if (twilioSid && twilioToken && twilioFrom) {
    for (const s of stubs) {
      try {
        const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
          method: "POST",
          headers: {
            Authorization: "Basic " + btoa(`${twilioSid}:${twilioToken}`),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ From: twilioFrom, To: s.to, Body: s.body }).toString(),
        });
        if (!resp.ok) {
          sendErrors.push({ to: s.to, error: `${resp.status} ${(await resp.text()).slice(0, 180)}` });
          continue;
        }
        sentCount++;
        const cid = consentIdByKind[s.kind];
        if (cid) await supa.from("consent_log").update({ confirmation_sent_at: new Date().toISOString() }).eq("id", cid);
      } catch (e) {
        sendErrors.push({ to: s.to, error: e instanceof Error ? e.message : "send_failed" });
      }
    }
  }
  const smsSent = sentCount > 0;

  return json(200, {
    status: "submitted",
    message: lang === "es"
      ? `Le acabamos de enviar un mensaje a ${teenName} para confirmar. ¡En cuanto responda, todo estará listo!`
      : `We just texted ${teenName} to confirm — once they reply, you're all set!`,
    pending_signup_id: signup.id,
    teen_consent_id: teenRow.id,
    plus_one_consent_id: plusOneId,
    age_gate: {
      teen: { country: teenGate.country, computed_age: teenGate.age, decision: teenGateDecision },
      plus_one: poGate ? { country: poGate.country, computed_age: poGate.age, decision: poGateDecision } : null,
    },
    sms_stubbed: !smsSent,
    sms_sent_count: sentCount,
    sms_would_send: smsSent ? undefined : stubs,
    sms_send_errors: sendErrors.length ? sendErrors : undefined,
    note: smsSent
      ? "No charge yet. Confirmation SMS sent; the subscription is created after the recipient replies YES (trial_end = 7d from that moment)."
      : "No charge yet, and Twilio is not credentialed — the confirmation SMS was composed + logged but NOT sent. Set TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER to enable delivery.",
  });
});
