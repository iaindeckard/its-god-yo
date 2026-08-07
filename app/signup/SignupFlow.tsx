"use client";

import { useEffect, useMemo, useState } from "react";
import SalutationSelect from "@/components/SalutationSelect";
import Link from "next/link";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import BubbleMark from "@/components/BubbleMark";
import Wordmark from "@/components/Wordmark";
import {
  t, ATTESTATION, DISCLOSURE, type Lang,
} from "@/lib/i18n";
import {
  PLANS, DM_ADDON, FAMILY_EXTRA_TEEN, FAMILY_BASE_TEENS,
} from "@/lib/plans";
import { submitConsent, type ConsentResult } from "@/lib/consent";
import { SPANISH_ENABLED } from "@/lib/flags";
import CountrySelect from "@/components/CountrySelect";
import { countryByIso2, DEFAULT_COUNTRY } from "@/lib/countries";
import { toE164FromParts } from "@/lib/phone";

// Best-effort browser timezone (IANA) captured at signup — the purchaser-level
// fallback for the Stage 2 send-time chain. Null if the browser can't resolve it.
function detectTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

const PK = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "";
let stripePromise: Promise<StripeJs | null> | null = null;
function getStripePromise() {
  if (!stripePromise && PK) stripePromise = loadStripe(PK);
  return stripePromise;
}

type PlanChoice = "individual" | "family" | "gift";

const STEP = { LANG: 0, FOCUS: 1, PLAN: 2, RECIPIENT: 3, PLUSONE: 4, REFERRAL: 5, PAY: 6, PHONE: 7, DONE: 8 } as const;

// Theme/mood tracks (locked taxonomy). Stored as theme_track on the subscription
// record; 'general' is the default. Labels here are display-only; the keys must
// match the theme_tracks table.
const THEME_TRACKS: Array<{ key: string; en: string; es: string }> = [
  { key: "general", en: "General, no preference", es: "General, sin preferencia" },
  { key: "joy_gratitude", en: "Joy & gratitude", es: "Alegría y gratitud" },
  { key: "gods_love_grace", en: "God’s love & grace", es: "El amor y la gracia de Dios" },
  { key: "patience_peace", en: "Patience & peace", es: "Paciencia y paz" },
  { key: "honesty_integrity", en: "Honesty & integrity", es: "Honestidad e integridad" },
  { key: "courage_confidence", en: "Courage & confidence", es: "Valor y confianza" },
  { key: "comfort_hard_times", en: "Comfort in hard times", es: "Consuelo en tiempos difíciles" },
];
// All 7 user tracks are enabled: each themed track now has approved content
// (seeded 2026-08-05, full August coverage in progress). On any day a themed
// track lacks an approved slot, the disclosed General no-silence fallback still
// serves that day (see lib/dailySend + THEMED_FALLBACK_DISCLOSURE below).
const ENABLED_TRACK_KEYS = new Set(THEME_TRACKS.map((t) => t.key));

// General-fallback disclosure, shown only when a THEMED (non-General) focus is
// selected — discloses that on days the chosen focus has no content, the
// subscriber receives that day's General verse instead of nothing (see the
// General fallback in lib/dailySend). Dormant while only General is enabled
// (never renders today).
// ⚠️ DRAFT WORDING — ATTORNEY REVIEW REQUIRED before any themed track re-launches
// with this copy visible. Do not treat as finalized legal/disclosure language.
const THEMED_FALLBACK_DISCLOSURE = {
  en: "Heads up: on the occasional day your focus doesn't have a message ready, you'll get that day's General verse instead, never nothing.",
  es: "Nota: en los días en que tu enfoque no tenga un mensaje listo, recibirás el versículo General de ese día, nunca te quedarás sin nada.",
} as const;
const TOTAL_DOTS = 7;

const money = (n: number) => `$${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`;

type Gate = {
  decision: "standard" | "enhanced" | "block";
  country: string | null;
  age: number;
  min_age: number;
  confirmed: boolean;
  mechanism: string | null;
};
const fillTpl = (tpl: string, vals: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k) => String(vals[k] ?? ""));
const validYear = (s: string) => {
  const y = Number(s);
  const now = new Date().getFullYear();
  return Number.isInteger(y) && y >= now - 120 && y <= now;
};

export default function SignupFlow({
  initialLang,
  initialPlan,
  church,
}: {
  initialLang: Lang;
  initialPlan?: string;
  // Set when the teen arrived via a church's group enrollment link (/join). Used
  // only for the "joining through {church}" banner + attribution on submit — it
  // does NOT change the plan, price, or consent gate.
  church?: { partnerId: string; linkId: string | null; churchName: string | null } | null;
}) {
  const [lang, setLang] = useState<Lang>(initialLang);

  // Spanish "notify me" waitlist — shown while Spanish isn't launched (SPANISH_ENABLED
  // false). Lightweight email capture only; NOT a preorder/payment hold.
  const [spanishOpen, setSpanishOpen] = useState(false);
  const [spanishEmail, setSpanishEmail] = useState("");
  const [spanishBusy, setSpanishBusy] = useState(false);
  const [spanishDone, setSpanishDone] = useState(false);
  const [spanishErr, setSpanishErr] = useState<string | null>(null);
  async function submitSpanishWaitlist() {
    const email = spanishEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setSpanishErr("Ingresa un correo válido.");
      return;
    }
    setSpanishBusy(true);
    setSpanishErr(null);
    try {
      const res = await fetch("/api/spanish-waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source: "signup_language_step" }),
      });
      if (!res.ok) { setSpanishErr("No se pudo guardar. Inténtalo de nuevo."); return; }
      setSpanishDone(true);
    } catch {
      setSpanishErr("No se pudo guardar. Inténtalo de nuevo.");
    } finally {
      setSpanishBusy(false);
    }
  }
  const [step, setStep] = useState<number>(STEP.LANG);
  const [themeTrack, setThemeTrack] = useState<string>("general");
  const s = t[lang];

  // plan
  const [planChoice, setPlanChoice] = useState<PlanChoice>(
    (["individual", "family", "gift"].includes(initialPlan || "") ? initialPlan : "individual") as PlanChoice
  );
  // Default the Individual plan to the $59/yr annual price (individual_annual,
  // price_1TyZ72…). Monthly stays selectable via the interval toggle.
  const [individualInterval, setIndividualInterval] = useState<"month" | "year">("year");
  // Family plan: 2+ teens, each their own phone (min 2). Extra teens are $28/yr.
  const [familyTeens, setFamilyTeens] = useState<Array<{ name: string; phone: string; year: string; country: string }>>([
    { name: "", phone: "", year: "", country: DEFAULT_COUNTRY },
    { name: "", phone: "", year: "", country: DEFAULT_COUNTRY },
  ]);
  const [familyAttest, setFamilyAttest] = useState(false);

  // recipient / purchaser
  const [teenFirstName, setTeenFirstName] = useState("");
  const [purchaserEmail, setPurchaserEmail] = useState("");
  const [purchaserFirstName, setPurchaserFirstName] = useState("");
  const [purchaserLastName, setPurchaserLastName] = useState("");
  const [purchaserSalutation, setPurchaserSalutation] = useState<string[]>([]);
  const [teenBirthYear, setTeenBirthYear] = useState("");
  const [teenGate, setTeenGate] = useState<Gate | null>(null);
  const [teenEnhancedAck, setTeenEnhancedAck] = useState(false);

  // DM from Him add-on — a single toggle for the SAME recipient (wraps their own
  // daily verse in a personal, first-person note). No second recipient.
  const [dmEnabled, setDmEnabled] = useState(false);

  // referral
  const [referralInput, setReferralInput] = useState("");
  const [referralApplied, setReferralApplied] = useState(false);
  const [referralBusy, setReferralBusy] = useState(false);
  const [referralError, setReferralError] = useState<string | null>(null);

  // promo code (SEPARATE from referral, lives at the payment step)
  const [promoInput, setPromoInput] = useState("");
  const [promoBusy, setPromoBusy] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  // A code that's otherwise valid but requires an add-on (e.g. DM from Him) that
  // isn't selected. Distinct from promoError (invalid/expired) so we can prompt the
  // customer to add the add-on rather than saying the code is bad.
  const [promoAddonMsg, setPromoAddonMsg] = useState<string | null>(null);
  const [promo, setPromo] = useState<{
    promotion_code_id: string; code: string; percent_off: number | null; amount_off: number | null; currency: string | null;
    requires_attestation: boolean; attestation_text: string | null;
  } | null>(null);
  // Affinity-code attestation checkbox (only shown when the applied promo requires it).
  const [promoAttest, setPromoAttest] = useState(false);

  // stripe
  const [stripeIds, setStripeIds] = useState<{ customer_id: string; setup_intent_id: string; payment_method_id: string } | null>(null);

  // phone / submit
  const [teenPhone, setTeenPhone] = useState("");
  const [teenCountry, setTeenCountry] = useState(DEFAULT_COUNTRY);
  // Canonical E.164 built from the selected country's dial code + the national
  // number the user types (see lib/phone.toE164FromParts).
  const teenPhoneE164 = toE164FromParts(countryByIso2(teenCountry).dial, teenPhone);
  const [primaryAttest, setPrimaryAttest] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConsentResult | null>(null);

  // Age-gate PREVIEW (the authoritative enforcement is server-side in
  // submit-consent; this only drives which UI branch shows).
  useEffect(() => {
    let cancelled = false;
    if (step === STEP.PHONE && teenPhoneE164 && validYear(teenBirthYear)) {
      fetch("/api/age-gate/check", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: teenPhoneE164, birth_year: Number(teenBirthYear) }),
      }).then((r) => (r.ok ? r.json() : null)).then((g) => { if (!cancelled) setTeenGate(g); }).catch(() => {});
    } else {
      setTeenGate(null);
    }
    return () => { cancelled = true; };
  }, [step, teenPhoneE164, teenBirthYear]);

  // ---- derived plan ----
  const resolved = useMemo(() => {
    if (planChoice === "individual") {
      return individualInterval === "month" ? PLANS.individual_monthly : PLANS.individual_annual;
    }
    if (planChoice === "family") return PLANS.family_annual;
    return PLANS.gift_annual; // gift
  }, [planChoice, individualInterval]);

  const baseAmount = resolved?.amount ?? 0;
  const baseInterval = resolved?.interval ?? "year";
  // Referrals no longer discount at signup — they credit the referee a free
  // month at their first invoice (via customer-balance credit, see lib/referral.ts).

  // Affinity-code attestation gate: when the applied promo requires attestation,
  // the purchaser must check the box before they can proceed past payment.
  const promoNeedsAttest = !!promo?.requires_attestation;
  const promoAttestOk = !promoNeedsAttest || promoAttest;

  function reset() {
    setStep(STEP.LANG);
    setThemeTrack("general");
    setResult(null);
    setError(null);
    setTeenFirstName(""); setPurchaserEmail(""); setTeenPhone(""); setPrimaryAttest(false);
    setPurchaserFirstName(""); setPurchaserLastName(""); setPurchaserSalutation([]);
    setDmEnabled(false); setStripeIds(null); setReferralApplied(false); setReferralInput(""); setReferralError(null);
    setPromo(null); setPromoInput(""); setPromoError(null); setPromoAddonMsg(null); setPromoAttest(false);
    setTeenBirthYear(""); setTeenGate(null); setTeenEnhancedAck(false);
  }

  async function runPromoValidation(rawCode: string) {
    const code = rawCode.trim();
    if (!code) return;
    if (referralApplied) { setPromo(null); setPromoError(s.referralExclusive); return; } // referral ⊕ promo
    setPromoError(null);
    setPromoAddonMsg(null);
    setPromoBusy(true);
    try {
      const res = await fetch("/api/promo/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // pass the selected plan (tier restriction) AND the current add-on selection
        // (required-add-on restriction) so the server enforces both here, not at submit.
        body: JSON.stringify({ code, plan_key: resolved?.key, dm_addon: dmEnabled }),
      });
      const data = await res.json();
      if (data.valid) {
        setPromoAttest(false); // a freshly-applied code must be re-attested
        setPromoAddonMsg(null);
        setPromo({
          promotion_code_id: data.promotion_code_id,
          code: data.code,
          percent_off: data.percent_off ?? null,
          amount_off: data.amount_off ?? null,
          currency: data.currency ?? null,
          requires_attestation: data.requires_attestation === true,
          attestation_text: data.attestation_text ?? null,
        });
      } else if (data.reason === "requires_addons") {
        // Otherwise-valid code, but a required add-on isn't selected — tell the
        // customer exactly what to add instead of calling the code invalid.
        setPromo(null);
        setPromoAddonMsg(data.message || s.promoRequiresAddon);
      } else {
        setPromo(null);
        setPromoError(s.promoInvalid);
      }
    } catch {
      setPromoError(s.promoInvalid);
    } finally {
      setPromoBusy(false);
    }
  }

  function applyPromo() {
    void runPromoValidation(promoInput);
  }

  // Re-validate an applied/blocked code when the add-on selection changes (e.g. the
  // customer turns DM from Him on/off): a code requiring the add-on reactivates when
  // it's added and drops with a clear message when it's removed — never a surprise
  // at submit. Only fires when there's a code in play, so it's a no-op for most flows.
  useEffect(() => {
    const activeCode = promo?.code ?? (promoAddonMsg ? promoInput : null);
    if (activeCode) void runPromoValidation(activeCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dmEnabled]);

  async function applyReferral() {
    setReferralError(null);
    if (promo) { setReferralApplied(false); setReferralError(s.referralExclusive); return; } // referral ⊕ promo
    const code = referralInput.trim();
    if (!code) return;
    setReferralBusy(true);
    try {
      const res = await fetch("/api/referral/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (data.valid) { setReferralApplied(true); setReferralError(null); }
      else { setReferralApplied(false); setReferralError(s.referralInvalid); }
    } catch {
      setReferralApplied(false); setReferralError(s.referralInvalid);
    } finally {
      setReferralBusy(false);
    }
  }

  // Best-effort: record referral attribution once the pending signup exists.
  // Never blocks/fails the signup — conversion re-resolves attribution anyway.
  async function attachReferral(pendingSignupId?: string) {
    if (!referralApplied || !pendingSignupId) return;
    try {
      await fetch("/api/referral/attach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingSignupId, code: referralInput.trim() }),
      });
    } catch { /* non-blocking */ }
  }

  const promoLabel = promo
    ? promo.percent_off != null
      ? `${promo.percent_off}% off`
      : promo.amount_off != null
        ? `$${(promo.amount_off / 100).toFixed(2)} off`
        : ""
    : "";

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await submitConsent({
        language: lang,
        theme_track: themeTrack,
        plan_key: resolved!.key,
        base_price_id: resolved!.price_id!,
        dm_addon: dmEnabled,
        dm_addon_price_id: dmEnabled ? DM_ADDON.price_id : null,
        referral_code: referralApplied ? referralInput.trim() : null,
        referral_discount_applied: false, // retired: referrals reward via balance credit, not a signup discount
        promo_code: promo?.code ?? null,
        promo_promotion_code_id: promo?.promotion_code_id ?? null,
        promo_attestation_confirmed: promoNeedsAttest ? promoAttest : false,
        promo_attestation_text: promoNeedsAttest ? promo?.attestation_text ?? null : null,
        purchaser_email: purchaserEmail.trim() || null,
        purchaser_timezone: detectTimezone(),
        purchaser_first_name: purchaserFirstName.trim() || null,
        purchaser_last_name: purchaserLastName.trim() || null,
        purchaser_salutation: purchaserSalutation,
        cornerstone_partner_id: church?.partnerId ?? null,
        enrollment_link_id: church?.linkId ?? null,
        teen: {
          first_name: teenFirstName.trim(),
          phone: teenPhoneE164,
          birth_year: Number(teenBirthYear),
          enhanced_consent_ack: teenGate?.decision === "enhanced" ? teenEnhancedAck : undefined,
        },
        stripe: stripeIds ?? undefined,
      });
      await attachReferral((res as { pending_signup_id?: string }).pending_signup_id);
      setResult(res);
      setStep(STEP.DONE);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  const familyExtra = Math.max(0, familyTeens.length - FAMILY_BASE_TEENS);
  const familyValid = familyTeens.every((tn) => tn.name.trim() && toE164FromParts(countryByIso2(tn.country).dial, tn.phone) && validYear(tn.year)) && familyAttest;

  async function handleSubmitFamily(ids: { customer_id: string; setup_intent_id: string; payment_method_id: string }) {
    setError(null);
    setSubmitting(true);
    try {
      const res = await submitConsent({
        language: lang,
        theme_track: themeTrack,
        plan_key: "family",
        base_price_id: PLANS.family_annual.price_id!,
        referral_code: referralApplied ? referralInput.trim() : null,
        referral_discount_applied: false, // retired: referrals reward via balance credit, not a signup discount
        promo_code: promo?.code ?? null,
        promo_promotion_code_id: promo?.promotion_code_id ?? null,
        promo_attestation_confirmed: promoNeedsAttest ? promoAttest : false,
        promo_attestation_text: promoNeedsAttest ? promo?.attestation_text ?? null : null,
        purchaser_email: purchaserEmail.trim() || null,
        purchaser_timezone: detectTimezone(),
        purchaser_first_name: purchaserFirstName.trim() || null,
        purchaser_last_name: purchaserLastName.trim() || null,
        purchaser_salutation: purchaserSalutation,
        cornerstone_partner_id: church?.partnerId ?? null,
        enrollment_link_id: church?.linkId ?? null,
        family_teens: familyTeens.map((tn) => ({ first_name: tn.name.trim(), phone: toE164FromParts(countryByIso2(tn.country).dial, tn.phone), birth_year: Number(tn.year) })),
        stripe: ids,
      });
      await attachReferral((res as { pending_signup_id?: string }).pending_signup_id);
      setResult(res);
      setStep(STEP.DONE);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  const dotIndex = Math.min(step, TOTAL_DOTS - 1);

  // Purchaser / account-holder identity: name + structured salutation. Shared by
  // both RECIPIENT steps (family + individual/gift/group). Salutation options are
  // ordered by the chosen signup language; the full combined list is always shown.
  const purchaserIdentityFields = (
    <>
      <div className="field">
        <label>{lang === "es" ? "Tu nombre" : "Your first name"}</label>
        <input value={purchaserFirstName} onChange={(e) => setPurchaserFirstName(e.target.value)} />
      </div>
      <div className="field">
        <label>{lang === "es" ? "Tu apellido" : "Your last name"}</label>
        <input value={purchaserLastName} onChange={(e) => setPurchaserLastName(e.target.value)} />
      </div>
      <SalutationSelect
        lang={lang}
        value={purchaserSalutation}
        onChange={setPurchaserSalutation}
        label={lang === "es" ? "Título(s)" : "Title(s)"}
        otherLabel={lang === "es" ? "Otro" : "Other"}
        hint={lang === "es" ? "Opcional. Elige los que apliquen. Puedes combinar títulos (p. ej. Rev. Dr.)." : "Optional. Pick any that apply. Combine titles if you like (e.g. Rev. Dr.)."}
      />
    </>
  );

  return (
    <main>
      {/* top bar: text-only wordmark, enlarged, top-left. The single speech-bubble
          mark is NOT in this lockup; it lives in the left gutter beside the form
          (see .signup-aside below). */}
      <div style={{ borderBottom: "1px solid var(--igy-line)" }}>
        <div className="container" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px" }}>
          <Link href="/" className="nav-brand" style={{ textDecoration: "none" }}>
            <Wordmark tone="flat" showIcon={false} className="signup-wordmark" />
          </Link>
          <Link href="/" className="muted" style={{ fontSize: 14 }}>✕</Link>
        </div>
      </div>

      <div className="container signup-body">
        {/* Single brand mark, parked in the dead space to the LEFT of the form.
            Purely decorative; hidden below the breakpoint where the gutter is too
            narrow to hold it without crowding the wizard (see globals.css). */}
        <div className="signup-aside" aria-hidden="true">
          <BubbleMark variant="primary" className="signup-aside-mark" />
        </div>
        <div className="wizard">
          {step < STEP.DONE && (
            <div className="steps" aria-hidden="true">
              {Array.from({ length: TOTAL_DOTS }).map((_, i) => (
                <div key={i} className={`dot ${i < dotIndex ? "done" : i === dotIndex ? "active" : ""}`} />
              ))}
            </div>
          )}

          {/* Church group enrollment banner — shown when the teen arrived via a
              church's /join link. Attribution only; the flow is otherwise normal. */}
          {church?.churchName && step < STEP.DONE && (
            <div
              style={{
                display: "flex", alignItems: "center", gap: 10, margin: "0 0 16px",
                padding: "10px 14px", borderRadius: 10, background: "rgba(0,171,188,0.10)",
                border: "1px solid rgba(0,171,188,0.35)", fontSize: 14, lineHeight: 1.4,
              }}
            >
              <span aria-hidden="true" style={{ fontSize: 18 }}>⛪</span>
              <span>
                You&rsquo;re joining through <strong>{church.churchName}</strong>. You&rsquo;ll still
                enter your own info and confirm by text.
              </span>
            </div>
          )}

          {error && <div className="error">{error}</div>}

          {/* ---------- 0. Language ---------- */}
          {step === STEP.LANG && (
            <section>
              <h2>{s.wLang}</h2>
              <p className="muted">{s.wLangSub}</p>
              <div style={{ display: "grid", gap: 12, marginTop: 20 }}>
                {((SPANISH_ENABLED ? ["en", "es"] : ["en"]) as Lang[]).map((L) => (
                  <div
                    key={L}
                    className={`choice ${lang === L ? "selected" : ""}`}
                    onClick={() => setLang(L)}
                    role="button"
                    tabIndex={0}
                  >
                    <span style={{ fontSize: 22 }}>{L === "en" ? "🇺🇸" : "🇲🇽"}</span>
                    <span className="c-title">{L === "en" ? t.en.english : t.es.spanish}</span>
                  </div>
                ))}

                {/* Spanish is not launched yet — offer a "coming soon" notify-me capture
                    instead of a selectable option (no preorder/payment). */}
                {!SPANISH_ENABLED && (
                  <div
                    className="choice"
                    onClick={() => !spanishDone && setSpanishOpen((o) => !o)}
                    role="button"
                    tabIndex={0}
                    aria-expanded={spanishOpen}
                    style={{ cursor: "pointer" }}
                  >
                    <span style={{ fontSize: 22 }}>🇲🇽</span>
                    <span className="c-title">Español</span>
                    <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: "#7686a0", background: "rgba(0,0,0,0.05)", padding: "3px 10px", borderRadius: 999, whiteSpace: "nowrap" }}>
                      Muy pronto
                    </span>
                  </div>
                )}
              </div>

              {!SPANISH_ENABLED && spanishOpen && !spanishDone && (
                <div className="field" style={{ marginTop: 12 }}>
                  <p className="muted" style={{ fontSize: 14, marginBottom: 8 }}>
                    El español aún no está listo. Déjanos tu correo y te avisamos en cuanto esté disponible.
                  </p>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      type="email"
                      value={spanishEmail}
                      placeholder="tú@correo.com"
                      aria-label="Correo electrónico"
                      onChange={(e) => { setSpanishEmail(e.target.value); setSpanishErr(null); }}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submitSpanishWaitlist(); } }}
                      style={{ flex: 1 }}
                    />
                    <button className="btn btn-primary" style={{ whiteSpace: "nowrap" }} disabled={spanishBusy || !spanishEmail.trim()} onClick={() => void submitSpanishWaitlist()}>
                      {spanishBusy ? "Enviando…" : "Avísame"}
                    </button>
                  </div>
                  {spanishErr && <p style={{ color: "#c0392b", fontSize: 13, marginTop: 6 }}>{spanishErr}</p>}
                </div>
              )}
              {!SPANISH_ENABLED && spanishDone && (
                <p style={{ marginTop: 12, color: "#2e7d32", fontSize: 14, fontWeight: 500 }}>
                  ¡Listo! Te avisaremos cuando el español esté disponible. 🙏
                </p>
              )}

              <div className="wizard-nav">
                <span />
                <button className="btn btn-primary" onClick={() => setStep(STEP.FOCUS)}>{s.continue}</button>
              </div>
            </section>
          )}

          {/* ---------- 0.5 Focus / theme track ---------- */}
          {step === STEP.FOCUS && (
            <section>
              <h2>{lang === "es" ? "Elige un enfoque" : "Pick a focus"}</h2>
              <p className="muted">
                {lang === "es"
                  ? "Elige el tipo de versículos que recibirán. Puedes dejarlo en general."
                  : "Choose the kind of verses they’ll get. You can keep it general."}
              </p>
              <div style={{ display: "grid", gap: 10, marginTop: 20 }}>
                {THEME_TRACKS.filter((tk) => ENABLED_TRACK_KEYS.has(tk.key)).map((tk) => (
                  <div
                    key={tk.key}
                    className={`choice ${themeTrack === tk.key ? "selected" : ""}`}
                    onClick={() => setThemeTrack(tk.key)}
                    role="button"
                    tabIndex={0}
                  >
                    <span className="c-title">{lang === "es" ? tk.es : tk.en}</span>
                  </div>
                ))}
              </div>
              {/* Themed-track fallback disclosure — renders only for a non-General
                  focus (dormant while General-only). ⚠️ wording pending attorney review. */}
              {themeTrack !== "general" && (
                <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>
                  {lang === "es" ? THEMED_FALLBACK_DISCLOSURE.es : THEMED_FALLBACK_DISCLOSURE.en}
                </p>
              )}
              <div className="wizard-nav">
                <button className="btn btn-ghost" onClick={() => setStep(STEP.LANG)}>{s.back}</button>
                <button className="btn btn-primary" onClick={() => setStep(STEP.PLAN)}>{s.continue}</button>
              </div>
            </section>
          )}

          {/* ---------- 1. Plan ---------- */}
          {step === STEP.PLAN && (
            <section>
              <h2>{s.wPlanTitle}</h2>
              <div style={{ marginTop: 16 }}>
                {/* Individual */}
                <div className={`choice ${planChoice === "individual" ? "selected" : ""}`} onClick={() => setPlanChoice("individual")} role="button" tabIndex={0}>
                  <div>
                    <div className="c-title">{s.planIndividualName}</div>
                    <div className="muted" style={{ fontSize: 14 }}>{s.planIndividualDesc}</div>
                  </div>
                  <div className="c-price">
                    {individualInterval === "year"
                      ? <>{money(PLANS.individual_annual.amount!)}{s.perYear}</>
                      : <>{money(PLANS.individual_monthly.amount!)}{s.perMonth}</>}
                  </div>
                </div>
                {planChoice === "individual" && (
                  <div className="lang-toggle" style={{ margin: "-4px 0 12px 16px" }}>
                    <button className={individualInterval === "month" ? "active" : ""} onClick={() => setIndividualInterval("month")}>
                      {money(PLANS.individual_monthly.amount!)}{s.perMonth}
                    </button>
                    <button className={individualInterval === "year" ? "active" : ""} onClick={() => setIndividualInterval("year")}>
                      {money(PLANS.individual_annual.amount!)}{s.perYear}
                    </button>
                  </div>
                )}

                {/* Family */}
                <div className={`choice ${planChoice === "family" ? "selected" : ""}`} onClick={() => setPlanChoice("family")} role="button" tabIndex={0}>
                  <div>
                    <div className="c-title">{s.planFamilyName}</div>
                    <div className="muted" style={{ fontSize: 14 }}>{s.planFamilyDesc}</div>
                  </div>
                  <div className="c-price">{money(PLANS.family_annual.amount!)}{s.perYear}</div>
                </div>

                {/* Gift */}
                <div className={`choice ${planChoice === "gift" ? "selected" : ""}`} onClick={() => setPlanChoice("gift")} role="button" tabIndex={0}>
                  <div>
                    <div className="c-title">{s.planGiftName}</div>
                    <div className="muted" style={{ fontSize: 14 }}>{s.planGiftDesc}</div>
                  </div>
                  <div className="c-price">{money(PLANS.gift_annual.amount!)}{s.perYear}</div>
                </div>
              </div>

              <div className="wizard-nav">
                <button className="btn btn-ghost" onClick={() => setStep(STEP.FOCUS)}>{s.back}</button>
                <button className="btn btn-primary" disabled={!resolved} onClick={() => setStep(STEP.RECIPIENT)}>
                  {s.continue}
                </button>
              </div>
            </section>
          )}

          {/* ---------- 2. Recipient — Family (multi-teen) ---------- */}
          {step === STEP.RECIPIENT && planChoice === "family" && (
            <section>
              <h2>{lang === "es" ? "¿Quiénes son tus jóvenes?" : "Who are your teens?"}</h2>
              <p className="muted">{lang === "es" ? "Cada joven recibe su propio texto y confirma por su cuenta. No se cobra por ninguno hasta que responda SÍ." : "Each teen gets their own text and confirms on their own. No teen is charged until they reply YES."}</p>
              {familyTeens.map((tn, i) => (
                <div key={i} style={{ border: "1px solid var(--igy-line)", borderRadius: 14, padding: 14, marginTop: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <strong style={{ fontSize: 14 }}>
                      {lang === "es" ? "Joven" : "Teen"} {i + 1}
                      {i >= FAMILY_BASE_TEENS && <span style={{ color: "var(--igy-blue)", fontWeight: 600 }}> · +{money(FAMILY_EXTRA_TEEN.amount)}{s.perYear}</span>}
                    </strong>
                    {familyTeens.length > FAMILY_BASE_TEENS && (
                      <button className="muted" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13 }} onClick={() => setFamilyTeens(familyTeens.filter((_, j) => j !== i))}>{lang === "es" ? "Quitar" : "Remove"}</button>
                    )}
                  </div>
                  <div className="row">
                    <div className="field" style={{ margin: 0 }}>
                      <label>{s.recipientFirstName}</label>
                      <input value={tn.name} onChange={(e) => setFamilyTeens(familyTeens.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                    </div>
                    <div className="field" style={{ margin: 0 }}>
                      <label>{s.birthYearLabel}</label>
                      <input type="number" inputMode="numeric" value={tn.year} placeholder="2010" onChange={(e) => setFamilyTeens(familyTeens.map((x, j) => (j === i ? { ...x, year: e.target.value } : x)))} />
                    </div>
                  </div>
                  <div className="field" style={{ marginBottom: 0, marginTop: 10 }}>
                    <label>{lang === "es" ? "País" : "Country"}</label>
                    <CountrySelect value={tn.country} lang={lang} onChange={(iso2) => setFamilyTeens(familyTeens.map((x, j) => (j === i ? { ...x, country: iso2 } : x)))} />
                  </div>
                  <div className="field" style={{ marginBottom: 0, marginTop: 10 }}>
                    <label>{s.recipientPhone}</label>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="muted" style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>+{countryByIso2(tn.country).dial}</span>
                      <input value={tn.phone} placeholder={lang === "es" ? "Número local" : "Local number"} inputMode="tel" style={{ flex: 1 }} onChange={(e) => setFamilyTeens(familyTeens.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)))} />
                    </div>
                  </div>
                </div>
              ))}
              <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => setFamilyTeens([...familyTeens, { name: "", phone: "", year: "", country: DEFAULT_COUNTRY }])}>
                + {lang === "es" ? "Agregar otro joven" : "Add another teen"} (+{money(FAMILY_EXTRA_TEEN.amount)}{s.perYear})
              </button>
              <div className="field" style={{ marginTop: 16 }}>
                <label>{s.purchaserEmailLabel}</label>
                <input type="email" value={purchaserEmail} onChange={(e) => setPurchaserEmail(e.target.value)} />
              </div>
              {purchaserIdentityFields}
              <div className="summary-line total" style={{ marginTop: 8 }}>
                <span>{lang === "es" ? "Total anual" : "Annual total"}</span>
                <span>{money(PLANS.family_annual.amount! + familyExtra * FAMILY_EXTRA_TEEN.amount)}{s.perYear}</span>
              </div>
              <p className="hint">
                {lang === "es" ? `El plan base ($99) cubre 2 jóvenes.${familyExtra > 0 ? ` +${familyExtra} × $28 por joven adicional.` : ""}` : `The base plan ($99) covers 2 teens.${familyExtra > 0 ? ` +${familyExtra} × $28 for each additional teen.` : ""}`}
              </p>
              <label className="check">
                <input type="checkbox" checked={familyAttest} onChange={(e) => setFamilyAttest(e.target.checked)} />
                <span>{lang === "es" ? "Confirmo que cada número es real, que tengo permiso para inscribir a cada joven, y que creo que querrían recibir estos mensajes." : "I confirm each of these is a real phone number, that I have permission to sign each teen up, and that I believe they'd want to receive this."}</span>
              </label>
              <div className="wizard-nav">
                <button className="btn btn-ghost" onClick={() => setStep(STEP.PLAN)}>{s.back}</button>
                <button className="btn btn-primary" disabled={!familyValid} onClick={() => setStep(STEP.REFERRAL)}>{s.continue}</button>
              </div>
            </section>
          )}

          {/* ---------- 2. Recipient ---------- */}
          {step === STEP.RECIPIENT && planChoice !== "family" && (
            <section>
              <h2>{s.wRecipientTitle}</h2>
              <p className="muted">{s.wRecipientSub}</p>
              <div className="field" style={{ marginTop: 16 }}>
                <label>{s.recipientFirstName}</label>
                <input value={teenFirstName} onChange={(e) => setTeenFirstName(e.target.value)} autoFocus />
              </div>
              <div className="field">
                <label>{s.birthYearLabel}</label>
                <input type="number" inputMode="numeric" value={teenBirthYear} onChange={(e) => setTeenBirthYear(e.target.value)} placeholder="2010" min={new Date().getFullYear() - 120} max={new Date().getFullYear()} />
                <p className="hint">{s.birthYearHint}</p>
              </div>
              <div className="field">
                <label>{s.purchaserEmailLabel}</label>
                <input type="email" value={purchaserEmail} onChange={(e) => setPurchaserEmail(e.target.value)} />
              </div>
              {purchaserIdentityFields}
              <div className="wizard-nav">
                <button className="btn btn-ghost" onClick={() => setStep(STEP.PLAN)}>{s.back}</button>
                <button className="btn btn-primary" disabled={!teenFirstName.trim() || !validYear(teenBirthYear)} onClick={() => setStep(STEP.PLUSONE)}>
                  {s.continue}
                </button>
              </div>
            </section>
          )}

          {/* ---------- 3. DM from Him add-on ---------- */}
          {step === STEP.PLUSONE && (
            <section>
              <h2>{s.wPlusOneTitle}</h2>
              <p className="muted">{s.wPlusOneSub}</p>
              <div style={{ marginTop: 16 }}>
                <div className={`choice ${dmEnabled ? "selected" : ""}`} onClick={() => setDmEnabled(true)} role="button" tabIndex={0}>
                  <div className="c-title">{s.addPlusOne}</div>
                  <div className="c-price">+{money(DM_ADDON.amount)}{s.perMonth}</div>
                </div>
                <div className={`choice ${!dmEnabled ? "selected" : ""}`} onClick={() => setDmEnabled(false)} role="button" tabIndex={0}>
                  <div className="c-title">{s.noThanks}</div>
                </div>
              </div>
              {dmEnabled && <p className="hint" style={{ marginTop: 12 }}>{s.dmAddonDesc}</p>}

              <div className="wizard-nav">
                <button className="btn btn-ghost" onClick={() => setStep(STEP.RECIPIENT)}>{s.back}</button>
                <button className="btn btn-primary" onClick={() => setStep(STEP.REFERRAL)}>{s.continue}</button>
              </div>
            </section>
          )}

          {/* ---------- 4. Referral ---------- */}
          {step === STEP.REFERRAL && (
            <section>
              <h2>{s.wReferralTitle}</h2>
              <p className="muted">{s.wReferralSub}</p>
              <div className="field" style={{ marginTop: 16 }}>
                <label>{s.referralLabel}</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    value={referralInput}
                    onChange={(e) => { setReferralInput(e.target.value); setReferralApplied(false); setReferralError(null); }}
                    placeholder="IGY-XXXXXXXX"
                    style={{ flex: 1 }}
                  />
                  <button className="btn btn-ghost" onClick={applyReferral} disabled={referralBusy || !referralInput.trim()}>
                    {referralBusy ? "…" : s.apply}
                  </button>
                </div>
                {referralApplied && <p className="hint" style={{ color: "var(--igy-blue)" }}>✓ {s.referralApplied}</p>}
                {referralError && <p className="hint" style={{ color: "var(--igy-error-text)" }}>{referralError}</p>}
              </div>
              <div className="wizard-nav">
                <button className="btn btn-ghost" onClick={() => setStep(STEP.PLUSONE)}>{s.back}</button>
                <button className="btn btn-primary" onClick={() => setStep(STEP.PAY)}>{s.continue}</button>
              </div>
            </section>
          )}

          {/* ---------- 5. Payment ---------- */}
          {step === STEP.PAY && (
            <section>
              <h2>{s.wPayTitle}</h2>
              <p className="muted">{s.wPaySub}</p>

              {/* mini review */}
              <div className="consent-box">
                <div className="summary-line">
                  <span>{s.plan}</span>
                  <span>{money(baseAmount)} / {baseInterval === "month" ? s.perMonth.replace("/", "") : s.perYear.replace("/", "")}</span>
                </div>
                {dmEnabled && (
                  <div className="summary-line">
                    <span>{s.addon}</span>
                    <span>+{money(DM_ADDON.amount)}{s.perMonth}</span>
                  </div>
                )}
                {referralApplied && (
                  <div className="summary-line">
                    <span>{s.referral}</span>
                    <span style={{ color: "var(--igy-blue)" }}>{s.referralFreeMonthShort}</span>
                  </div>
                )}
                {promo && (
                  <div className="summary-line">
                    <span>{s.promoFieldLabel} ({promo.code})</span>
                    <span>{promoLabel}</span>
                  </div>
                )}
              </div>

              {/* Promo code — a SEPARATE field from the referral code (which
                  lives on its own earlier step). Placed here at payment, where a
                  discount conceptually belongs, with distinct labelling so the
                  two are never confused. */}
              <div className="field" style={{ borderTop: "1px dashed var(--igy-line)", paddingTop: 16 }}>
                <label>🎟️ {s.promoFieldLabel}</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    value={promoInput}
                    onChange={(e) => { setPromoInput(e.target.value.toUpperCase()); setPromo(null); setPromoError(null); setPromoAddonMsg(null); setPromoAttest(false); }}
                    placeholder={s.promoFieldPlaceholder}
                    style={{ flex: 1 }}
                  />
                  <button className="btn btn-ghost" onClick={applyPromo} disabled={promoBusy || !promoInput.trim()}>
                    {promoBusy ? "…" : s.apply}
                  </button>
                </div>
                {promo && <p className="hint" style={{ color: "var(--igy-blue)" }}>✓ {s.promoApplied}: {promoLabel}</p>}
                {promoError && <p className="hint" style={{ color: "var(--igy-error-text)" }}>{promoError}</p>}
                {promoAddonMsg && <p className="hint" style={{ color: "var(--igy-error-text)" }}>{promoAddonMsg}</p>}
                {!promo && !promoError && !promoAddonMsg && <p className="hint">{s.promoFieldHint}</p>}

                {/* Affinity-code attestation — required before this discount can be
                    used. The exact statement comes from the promo code (Stripe
                    metadata) so it's the source of truth; checking it is gated on
                    below and logged server-side (promo_attestations). */}
                {promo?.requires_attestation && promo.attestation_text && (
                  <div style={{ marginTop: 14 }}>
                    <p className="eyebrow">{s.attestationHeading}</p>
                    <div className="consent-box">{promo.attestation_text}</div>
                    <label className="check">
                      <input type="checkbox" checked={promoAttest} onChange={(e) => setPromoAttest(e.target.checked)} />
                      <span>{s.iConfirm}</span>
                    </label>
                  </div>
                )}
              </div>

              {stripeIds ? (
                <>
                  <div className="consent-box" style={{ background: "var(--igy-success-bg)", borderColor: "var(--igy-success-border)", color: "var(--igy-success-text)" }}>
                    ✓ {lang === "es" ? "Tarjeta guardada (sin cobro)." : "Card saved (no charge)."}
                  </div>
                  <div className="wizard-nav">
                    <button className="btn btn-ghost" onClick={() => setStep(STEP.REFERRAL)}>{s.back}</button>
                    <button className="btn btn-primary" disabled={!promoAttestOk} onClick={() => setStep(STEP.PHONE)}>{s.continue}</button>
                  </div>
                </>
              ) : !promoAttestOk ? (
                <p className="hint" style={{ color: "var(--igy-error-text)" }}>
                  {lang === "es"
                    ? "Confirma la declaración de arriba para continuar al pago."
                    : "Confirm the attestation above to continue to payment."}
                </p>
              ) : (
                <PaymentStep
                  lang={lang}
                  email={purchaserEmail}
                  onBack={() => setStep(STEP.REFERRAL)}
                  onDone={(ids) => {
                    setStripeIds(ids);
                    if (planChoice === "family") void handleSubmitFamily(ids); // phones already collected up front
                    else setStep(STEP.PHONE);
                  }}
                />
              )}
            </section>
          )}

          {/* ---------- 6. Phone + submit ---------- */}
          {step === STEP.PHONE && (
            <section>
              <h2>{s.wPhoneTitle}</h2>
              <p className="muted">{s.wPhoneSub}</p>
              <div className="field" style={{ marginTop: 16 }}>
                <label>{lang === "es" ? "País" : "Country"}</label>
                <CountrySelect value={teenCountry} onChange={setTeenCountry} lang={lang} />
              </div>
              <div className="field">
                <label>{s.recipientPhone} ({teenFirstName})</label>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="muted" style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>+{countryByIso2(teenCountry).dial}</span>
                  <input value={teenPhone} onChange={(e) => setTeenPhone(e.target.value)} placeholder={lang === "es" ? "Número local" : "Local number"} inputMode="tel" autoComplete="tel-national" style={{ flex: 1 }} autoFocus />
                </div>
              </div>
              <AgeGateNotice gate={teenGate} lang={lang} ackChecked={teenEnhancedAck} onAck={setTeenEnhancedAck} />
              {teenGate?.decision !== "block" && (
                <>
                  <p className="eyebrow">{s.attestationHeading}</p>
                  <div className="consent-box">{ATTESTATION[lang](teenFirstName.trim() || (lang === "es" ? "esta persona" : "them"))}</div>
                  <p className="eyebrow">{s.disclosureHeading}</p>
                  <div className="consent-box">{DISCLOSURE[lang](teenFirstName.trim() || (lang === "es" ? "Esta persona" : "They"))}</div>
                  <label className="check">
                    <input type="checkbox" checked={primaryAttest} onChange={(e) => setPrimaryAttest(e.target.checked)} />
                    <span>{s.iConfirm}</span>
                  </label>
                </>
              )}
              <div className="wizard-nav">
                <button className="btn btn-ghost" onClick={() => setStep(STEP.PAY)}>{s.back}</button>
                {teenGate?.decision !== "block" && (
                  <button
                    className="btn btn-primary"
                    disabled={
                      !teenPhoneE164 || !primaryAttest || submitting || !validYear(teenBirthYear) ||
                      teenGate === null || (teenGate.decision === "enhanced" && !teenEnhancedAck)
                    }
                    onClick={handleSubmit}
                  >
                    {submitting ? s.submitting : s.submitSignup}
                  </button>
                )}
              </div>
            </section>
          )}

          {/* ---------- 7. Done ---------- */}
          {step === STEP.DONE && result && (
            <section className="center">
              <div className="success-check">✓</div>
              <h2>{s.doneTitle}</h2>
              <p className="muted" style={{ maxWidth: 460, margin: "0 auto 8px" }}>{result.message}</p>
              <p className="hint">{s.noChargeYet}</p>
              <div style={{ marginTop: 24 }}>
                <Link className="btn btn-primary" href="/">{lang === "es" ? "Volver al inicio" : "Back home"}</Link>
                <button className="btn btn-ghost" style={{ marginLeft: 10 }} onClick={reset}>{s.startOver}</button>
              </div>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

/* ---------------- Age-gate notice (block / enhanced shell) ---------------- */
function AgeGateNotice({
  gate,
  lang,
  ackChecked,
  onAck,
}: {
  gate: Gate | null;
  lang: Lang;
  ackChecked: boolean;
  onAck: (b: boolean) => void;
}) {
  if (!gate) return null;
  const s = t[lang];

  if (gate.decision === "block") {
    return (
      <div className="error" role="alert">
        <strong>{s.ageBlockTitle}</strong>
        <p style={{ margin: "6px 0 0" }}>
          {gate.country ? fillTpl(s.ageBlockMsgTpl, { age: gate.min_age, country: gate.country }) : s.ageBlockMsgNoCountry}
        </p>
      </div>
    );
  }

  if (gate.decision === "enhanced") {
    // Enhanced-consent SHELL only. It collects intent, NOT verified consent —
    // the full verification mechanism is not built yet.
    return (
      <div className="consent-box" style={{ borderColor: "var(--igy-caution-border)", background: "var(--igy-caution-bg)" }}>
        <strong>{s.enhancedTitle}</strong>
        <p style={{ margin: "6px 0" }}>{fillTpl(s.enhancedMsgTpl, { age: gate.min_age, country: gate.country ?? "" })}</p>
        <label className="check">
          <input type="checkbox" checked={ackChecked} onChange={(e) => onAck(e.target.checked)} />
          <span>{s.enhancedAck}</span>
        </label>
      </div>
    );
  }
  return null; // standard -> no special notice
}

/* ---------------- Stripe payment sub-step ---------------- */
function PaymentStep({
  lang,
  email,
  onDone,
  onBack,
}: {
  lang: Lang;
  email: string;
  onDone: (ids: { customer_id: string; setup_intent_id: string; payment_method_id: string }) => void;
  onBack: () => void;
}) {
  const s = t[lang];
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [ids, setIds] = useState<{ customer_id: string; setup_intent_id: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!PK) {
      setErr(lang === "es" ? "Falta la clave de Stripe (configura NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)." : "Stripe key missing (set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY).");
      return;
    }
    fetch("/api/setup-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, language: lang }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) setErr(d.error);
        else {
          setClientSecret(d.client_secret);
          setIds({ customer_id: d.customer_id, setup_intent_id: d.setup_intent_id });
        }
      })
      .catch((e) => !cancelled && setErr(String(e)));
    return () => { cancelled = true; };
  }, [email, lang]);

  if (err) {
    return (
      <>
        <div className="error">{err}</div>
        <div className="wizard-nav">
          <button className="btn btn-ghost" onClick={onBack}>{s.back}</button>
          <span />
        </div>
      </>
    );
  }
  if (!clientSecret || !ids) {
    return <div className="consent-box">{lang === "es" ? "Cargando pago seguro…" : "Loading secure payment…"}</div>;
  }

  return (
    <Elements
      stripe={getStripePromise()}
      options={{ clientSecret, appearance: { theme: "flat", variables: { colorPrimary: "#378ADD", borderRadius: "12px" } } }}
    >
      <CardForm lang={lang} onBack={onBack} onDone={(pmId) => onDone({ ...ids, payment_method_id: pmId })} />
    </Elements>
  );
}

function CardForm({
  lang,
  onDone,
  onBack,
}: {
  lang: Lang;
  onDone: (paymentMethodId: string) => void;
  onBack: () => void;
}) {
  const s = t[lang];
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!stripe || !elements) return;
    setBusy(true);
    setErr(null);
    const { error, setupIntent } = await stripe.confirmSetup({ elements, redirect: "if_required" });
    if (error) {
      setErr(error.message || "Card error");
      setBusy(false);
      return;
    }
    const pm = setupIntent?.payment_method;
    const pmId = typeof pm === "string" ? pm : pm?.id;
    if (!pmId) {
      setErr(lang === "es" ? "No se pudo guardar la tarjeta." : "Couldn't save the card.");
      setBusy(false);
      return;
    }
    onDone(pmId);
  }

  return (
    <div>
      <div style={{ margin: "8px 0 4px" }}>
        <PaymentElement />
      </div>
      {err && <div className="error">{err}</div>}
      <div className="wizard-nav">
        <button className="btn btn-ghost" onClick={onBack} disabled={busy}>{s.back}</button>
        <button className="btn btn-primary" onClick={save} disabled={busy || !stripe}>
          {busy ? s.cardProcessing : s.saveCard}
        </button>
      </div>
    </div>
  );
}
