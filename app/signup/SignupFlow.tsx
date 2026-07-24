"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import BubbleMark from "@/components/BubbleMark";
import Wordmark from "@/components/Wordmark";
import {
  t, ATTESTATION, DISCLOSURE, HONORIFICS, RELATIONSHIPS, type Lang,
} from "@/lib/i18n";
import {
  PLANS, GROUP_BANDS, DM_ADDON, FAMILY_EXTRA_TEEN, FAMILY_BASE_TEENS, bandForCount, GROUP_CONTACT_THRESHOLD,
} from "@/lib/plans";
import { submitConsent, normalizePhone, type ConsentResult } from "@/lib/consent";

const PK = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "";
let stripePromise: Promise<StripeJs | null> | null = null;
function getStripePromise() {
  if (!stripePromise && PK) stripePromise = loadStripe(PK);
  return stripePromise;
}

type PlanChoice = "individual" | "family" | "gift" | "group";

const STEP = { LANG: 0, FOCUS: 1, PLAN: 2, RECIPIENT: 3, PLUSONE: 4, REFERRAL: 5, PAY: 6, PHONE: 7, DONE: 8 } as const;

// Theme/mood tracks (locked taxonomy). Stored as theme_track on the subscription
// record; 'general' is the default. Labels here are display-only; the keys must
// match the theme_tracks table.
const THEME_TRACKS: Array<{ key: string; en: string; es: string }> = [
  { key: "general", en: "General — no preference", es: "General — sin preferencia" },
  { key: "joy_gratitude", en: "Joy & gratitude", es: "Alegría y gratitud" },
  { key: "gods_love_grace", en: "God’s love & grace", es: "El amor y la gracia de Dios" },
  { key: "patience_peace", en: "Patience & peace", es: "Paciencia y paz" },
  { key: "honesty_integrity", en: "Honesty & integrity", es: "Honestidad e integridad" },
  { key: "courage_confidence", en: "Courage & confidence", es: "Valor y confianza" },
  { key: "comfort_hard_times", en: "Comfort in hard times", es: "Consuelo en tiempos difíciles" },
];
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
}: {
  initialLang: Lang;
  initialPlan?: string;
}) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [step, setStep] = useState<number>(STEP.LANG);
  const [themeTrack, setThemeTrack] = useState<string>("general");
  const s = t[lang];

  // plan
  const [planChoice, setPlanChoice] = useState<PlanChoice>(
    (["individual", "family", "gift", "group"].includes(initialPlan || "") ? initialPlan : "individual") as PlanChoice
  );
  const [individualInterval, setIndividualInterval] = useState<"month" | "year">("month");
  const [teenCount, setTeenCount] = useState<number>(25);
  // Family plan: 2+ teens, each their own phone (min 2). Extra teens are $28/yr.
  const [familyTeens, setFamilyTeens] = useState<Array<{ name: string; phone: string; year: string }>>([
    { name: "", phone: "", year: "" },
    { name: "", phone: "", year: "" },
  ]);
  const [familyAttest, setFamilyAttest] = useState(false);

  // recipient / purchaser
  const [teenFirstName, setTeenFirstName] = useState("");
  const [purchaserEmail, setPurchaserEmail] = useState("");
  const [teenBirthYear, setTeenBirthYear] = useState("");
  const [teenGate, setTeenGate] = useState<Gate | null>(null);
  const [teenEnhancedAck, setTeenEnhancedAck] = useState(false);

  // plus-one (DM from Him)
  const [poEnabled, setPoEnabled] = useState(false);
  const [poHonorific, setPoHonorific] = useState("");
  const [poRelationship, setPoRelationship] = useState("");
  const [poGifterFirst, setPoGifterFirst] = useState("");
  const [poGifterLast, setPoGifterLast] = useState("");
  const [poRecipientName, setPoRecipientName] = useState("");
  const [poRecipientPhone, setPoRecipientPhone] = useState("");
  const [poBirthYear, setPoBirthYear] = useState("");
  const [poGate, setPoGate] = useState<Gate | null>(null);
  const [poEnhancedAck, setPoEnhancedAck] = useState(false);
  const [poAttest, setPoAttest] = useState(false);

  // referral
  const [referralInput, setReferralInput] = useState("");
  const [referralApplied, setReferralApplied] = useState(false);
  const [referralBusy, setReferralBusy] = useState(false);
  const [referralError, setReferralError] = useState<string | null>(null);

  // promo code (SEPARATE from referral, lives at the payment step)
  const [promoInput, setPromoInput] = useState("");
  const [promoBusy, setPromoBusy] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promo, setPromo] = useState<{
    promotion_code_id: string; code: string; percent_off: number | null; amount_off: number | null; currency: string | null;
  } | null>(null);

  // stripe
  const [stripeIds, setStripeIds] = useState<{ customer_id: string; setup_intent_id: string; payment_method_id: string } | null>(null);

  // phone / submit
  const [teenPhone, setTeenPhone] = useState("");
  const [primaryAttest, setPrimaryAttest] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConsentResult | null>(null);

  // Age-gate PREVIEW (the authoritative enforcement is server-side in
  // submit-consent; this only drives which UI branch shows).
  useEffect(() => {
    let cancelled = false;
    if (step === STEP.PHONE && teenPhone.trim() && validYear(teenBirthYear)) {
      fetch("/api/age-gate/check", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: normalizePhone(teenPhone), birth_year: Number(teenBirthYear) }),
      }).then((r) => (r.ok ? r.json() : null)).then((g) => { if (!cancelled) setTeenGate(g); }).catch(() => {});
    } else {
      setTeenGate(null);
    }
    return () => { cancelled = true; };
  }, [step, teenPhone, teenBirthYear]);

  useEffect(() => {
    let cancelled = false;
    if (poEnabled && poRecipientPhone.trim() && validYear(poBirthYear)) {
      fetch("/api/age-gate/check", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: normalizePhone(poRecipientPhone), birth_year: Number(poBirthYear) }),
      }).then((r) => (r.ok ? r.json() : null)).then((g) => { if (!cancelled) setPoGate(g); }).catch(() => {});
    } else {
      setPoGate(null);
    }
    return () => { cancelled = true; };
  }, [poEnabled, poRecipientPhone, poBirthYear]);

  // ---- derived plan ----
  const band = planChoice === "group" ? bandForCount(teenCount) : null;
  const isGroupContact = planChoice === "group" && teenCount >= GROUP_CONTACT_THRESHOLD;

  const resolved = useMemo(() => {
    if (planChoice === "individual") {
      return individualInterval === "month" ? PLANS.individual_monthly : PLANS.individual_annual;
    }
    if (planChoice === "family") return PLANS.family_annual;
    if (planChoice === "gift") return PLANS.gift_annual;
    if (band) {
      return {
        key: band.band_key,
        price_id: band.price_id,
        amount: band.amount,
        interval: "year" as const,
        per: "teen" as const,
      };
    }
    return null; // group contact
  }, [planChoice, individualInterval, band]);

  const baseAmount =
    planChoice === "group" && band ? band.amount * teenCount : resolved?.amount ?? 0;
  const baseInterval = resolved?.interval ?? "year";
  // Referrals no longer discount at signup — they credit the referee a free
  // month at their first invoice (via customer-balance credit, see lib/referral.ts).

  function reset() {
    setStep(STEP.LANG);
    setThemeTrack("general");
    setResult(null);
    setError(null);
    setTeenFirstName(""); setPurchaserEmail(""); setTeenPhone(""); setPrimaryAttest(false);
    setPoEnabled(false); setPoAttest(false); setStripeIds(null); setReferralApplied(false); setReferralInput(""); setReferralError(null);
    setPromo(null); setPromoInput(""); setPromoError(null);
    setTeenBirthYear(""); setTeenGate(null); setTeenEnhancedAck(false);
    setPoBirthYear(""); setPoGate(null); setPoEnhancedAck(false);
  }

  async function applyPromo() {
    if (referralApplied) { setPromo(null); setPromoError(s.referralExclusive); return; } // referral ⊕ promo
    setPromoError(null);
    setPromoBusy(true);
    try {
      const res = await fetch("/api/promo/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // pass the selected plan so the server enforces any tier restriction on the code
        body: JSON.stringify({ code: promoInput.trim(), plan_key: resolved?.key }),
      });
      const data = await res.json();
      if (data.valid) {
        setPromo({
          promotion_code_id: data.promotion_code_id,
          code: data.code,
          percent_off: data.percent_off ?? null,
          amount_off: data.amount_off ?? null,
          currency: data.currency ?? null,
        });
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
        group_teen_count: planChoice === "group" ? teenCount : null,
        dm_addon: poEnabled,
        dm_addon_price_id: poEnabled ? DM_ADDON.price_id : null,
        referral_code: referralApplied ? referralInput.trim() : null,
        referral_discount_applied: false, // retired: referrals reward via balance credit, not a signup discount
        promo_code: promo?.code ?? null,
        promo_promotion_code_id: promo?.promotion_code_id ?? null,
        purchaser_email: purchaserEmail.trim() || null,
        teen: {
          first_name: teenFirstName.trim(),
          phone: normalizePhone(teenPhone),
          birth_year: Number(teenBirthYear),
          enhanced_consent_ack: teenGate?.decision === "enhanced" ? teenEnhancedAck : undefined,
        },
        plus_one: poEnabled
          ? {
              gifter_first_name: poGifterFirst.trim(),
              gifter_last_name: poGifterLast.trim() || undefined,
              gifter_honorific: poHonorific || undefined,
              gifter_relationship: poRelationship || undefined,
              recipient_first_name: poRecipientName.trim() || undefined,
              recipient_phone: normalizePhone(poRecipientPhone),
              recipient_birth_year: Number(poBirthYear),
              attestation_confirmed: poAttest,
              enhanced_consent_ack: poGate?.decision === "enhanced" ? poEnhancedAck : undefined,
            }
          : null,
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
  const familyValid = familyTeens.every((tn) => tn.name.trim() && tn.phone.trim() && validYear(tn.year)) && familyAttest;

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
        purchaser_email: purchaserEmail.trim() || null,
        family_teens: familyTeens.map((tn) => ({ first_name: tn.name.trim(), phone: normalizePhone(tn.phone), birth_year: Number(tn.year) })),
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

  return (
    <main>
      {/* top bar */}
      <div style={{ borderBottom: "1px solid var(--igy-line)" }}>
        <div className="container" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px" }}>
          <Link href="/" className="nav-brand" style={{ textDecoration: "none" }}>
            <BubbleMark variant="primary" size={32} />
            <Wordmark tone="flat" />
          </Link>
          <Link href="/" className="muted" style={{ fontSize: 14 }}>✕</Link>
        </div>
      </div>

      <div className="container">
        <div className="wizard">
          {step < STEP.DONE && (
            <div className="steps" aria-hidden="true">
              {Array.from({ length: TOTAL_DOTS }).map((_, i) => (
                <div key={i} className={`dot ${i < dotIndex ? "done" : i === dotIndex ? "active" : ""}`} />
              ))}
            </div>
          )}

          {error && <div className="error">{error}</div>}

          {/* ---------- 0. Language ---------- */}
          {step === STEP.LANG && (
            <section>
              <h2>{s.wLang}</h2>
              <p className="muted">{s.wLangSub}</p>
              <div style={{ display: "grid", gap: 12, marginTop: 20 }}>
                {(["en", "es"] as Lang[]).map((L) => (
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
              </div>
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
                {THEME_TRACKS.map((tk) => (
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
                    {money(PLANS.individual_monthly.amount!)}{s.perMonth}
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

                {/* Group */}
                <div className={`choice ${planChoice === "group" ? "selected" : ""}`} onClick={() => setPlanChoice("group")} role="button" tabIndex={0}>
                  <div>
                    <div className="c-title">{s.planGroupName}</div>
                    <div className="muted" style={{ fontSize: 14 }}>{s.planGroupDesc}</div>
                  </div>
                  <div className="c-price">{s.from} {money(GROUP_BANDS[0].amount)}{s.perTeenYear}</div>
                </div>

                {planChoice === "group" && (
                  <div className="field" style={{ marginLeft: 16, marginTop: 8 }}>
                    <label>{s.teenCount}</label>
                    <input
                      type="number"
                      min={1}
                      value={teenCount}
                      onChange={(e) => setTeenCount(Math.max(1, parseInt(e.target.value || "1", 10)))}
                    />
                    <p className="hint">{s.teenCountHint}</p>
                    {isGroupContact ? (
                      <div className="consent-box">
                        <strong>{s.groupContactTitle}</strong>
                        <p style={{ margin: "6px 0 0" }}>{s.groupContactBody}</p>
                        <a className="btn btn-primary" style={{ marginTop: 12 }} href={`mailto:hello@itsgodyo.com?subject=Group%20quote%20(${teenCount}%20teens)`}>
                          {s.requestQuote}
                        </a>
                      </div>
                    ) : band ? (
                      <div className="consent-box">
                        <div className="summary-line">
                          <span>{teenCount} × {money(band.amount)}{s.perTeenYear}</span>
                          <strong>{money(band.amount * teenCount)} {s.perYearTotal}</strong>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="wizard-nav">
                <button className="btn btn-ghost" onClick={() => setStep(STEP.FOCUS)}>{s.back}</button>
                <button className="btn btn-primary" disabled={isGroupContact || !resolved} onClick={() => setStep(STEP.RECIPIENT)}>
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
                    <label>{s.recipientPhone}</label>
                    <input value={tn.phone} placeholder="+1 555 123 4567" onChange={(e) => setFamilyTeens(familyTeens.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)))} />
                  </div>
                </div>
              ))}
              <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => setFamilyTeens([...familyTeens, { name: "", phone: "", year: "" }])}>
                + {lang === "es" ? "Agregar otro joven" : "Add another teen"} (+{money(FAMILY_EXTRA_TEEN.amount)}{s.perYear})
              </button>
              <div className="field" style={{ marginTop: 16 }}>
                <label>{s.purchaserEmailLabel}</label>
                <input type="email" value={purchaserEmail} onChange={(e) => setPurchaserEmail(e.target.value)} />
              </div>
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
              <div className="wizard-nav">
                <button className="btn btn-ghost" onClick={() => setStep(STEP.PLAN)}>{s.back}</button>
                <button className="btn btn-primary" disabled={!teenFirstName.trim() || !validYear(teenBirthYear)} onClick={() => setStep(STEP.PLUSONE)}>
                  {s.continue}
                </button>
              </div>
            </section>
          )}

          {/* ---------- 3. Plus-one ---------- */}
          {step === STEP.PLUSONE && (
            <section>
              <h2>{s.wPlusOneTitle}</h2>
              <p className="muted">{s.wPlusOneSub}</p>
              <div style={{ marginTop: 16 }}>
                <div className={`choice ${poEnabled ? "selected" : ""}`} onClick={() => setPoEnabled(true)} role="button" tabIndex={0}>
                  <div className="c-title">{s.addPlusOne}</div>
                  <div className="c-price">+{money(DM_ADDON.amount)}{s.perMonth}</div>
                </div>
                <div className={`choice ${!poEnabled ? "selected" : ""}`} onClick={() => setPoEnabled(false)} role="button" tabIndex={0}>
                  <div className="c-title">{s.noThanks}</div>
                </div>
              </div>

              {poEnabled && (
                <div style={{ marginTop: 12 }}>
                  <h3 style={{ fontSize: 17 }}>{s.fromWho}</h3>
                  <div className="row">
                    <div className="field">
                      <label>{s.honorificLabel}</label>
                      <select value={poHonorific} onChange={(e) => { setPoHonorific(e.target.value); if (e.target.value) setPoRelationship(""); }}>
                        <option value="">{s.honorificNone}</option>
                        {HONORIFICS[lang].map((h) => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                    <div className="field">
                      <label>{s.relationshipLabel}</label>
                      <select value={poRelationship} onChange={(e) => setPoRelationship(e.target.value)} disabled={!!poHonorific}>
                        <option value="">{s.relationshipPick}</option>
                        {RELATIONSHIPS[lang].map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="row">
                    <div className="field">
                      <label>{s.gifterFirstName}</label>
                      <input value={poGifterFirst} onChange={(e) => setPoGifterFirst(e.target.value)} />
                    </div>
                    <div className="field">
                      <label>{s.gifterLastName}</label>
                      <input value={poGifterLast} onChange={(e) => setPoGifterLast(e.target.value)} />
                    </div>
                  </div>
                  <div className="field">
                    <label>{s.plusOneRecipientName}</label>
                    <input value={poRecipientName} onChange={(e) => setPoRecipientName(e.target.value)} />
                  </div>
                  <div className="field">
                    <label>{s.plusOneRecipientPhone}</label>
                    <input value={poRecipientPhone} onChange={(e) => setPoRecipientPhone(e.target.value)} placeholder="+1 555 123 4567" />
                  </div>
                  <div className="field">
                    <label>{s.birthYearLabel}</label>
                    <input type="number" inputMode="numeric" value={poBirthYear} onChange={(e) => setPoBirthYear(e.target.value)} placeholder="2010" min={new Date().getFullYear() - 120} max={new Date().getFullYear()} />
                    <p className="hint">{s.birthYearHint}</p>
                  </div>
                  <AgeGateNotice gate={poGate} lang={lang} ackChecked={poEnhancedAck} onAck={setPoEnhancedAck} />
                  <div className="consent-box">{ATTESTATION[lang](poRecipientName.trim() || (lang === "es" ? "esta persona" : "them"))}</div>
                  <div className="consent-box">{DISCLOSURE[lang](poRecipientName.trim() || (lang === "es" ? "Esta persona" : "They"))}</div>
                  <label className="check">
                    <input type="checkbox" checked={poAttest} onChange={(e) => setPoAttest(e.target.checked)} />
                    <span>{s.iConfirm}</span>
                  </label>
                </div>
              )}

              <div className="wizard-nav">
                <button className="btn btn-ghost" onClick={() => setStep(STEP.RECIPIENT)}>{s.back}</button>
                <button
                  className="btn btn-primary"
                  disabled={
                    poEnabled && !(
                      poGifterFirst.trim() && (poHonorific || poRelationship) && poRecipientPhone.trim() && poAttest &&
                      validYear(poBirthYear) &&
                      poGate !== null && poGate.decision !== "block" &&
                      (poGate.decision !== "enhanced" || poEnhancedAck)
                    )
                  }
                  onClick={() => setStep(STEP.REFERRAL)}
                >
                  {s.continue}
                </button>
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
                  <span>{planChoice === "group" ? `${teenCount} × ${money(band?.amount ?? 0)}` : money(baseAmount)} / {baseInterval === "month" ? s.perMonth.replace("/", "") : s.perYear.replace("/", "")}</span>
                </div>
                {poEnabled && (
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
                    onChange={(e) => { setPromoInput(e.target.value.toUpperCase()); setPromo(null); setPromoError(null); }}
                    placeholder={s.promoFieldPlaceholder}
                    style={{ flex: 1 }}
                  />
                  <button className="btn btn-ghost" onClick={applyPromo} disabled={promoBusy || !promoInput.trim()}>
                    {promoBusy ? "…" : s.apply}
                  </button>
                </div>
                {promo && <p className="hint" style={{ color: "var(--igy-blue)" }}>✓ {s.promoApplied}: {promoLabel}</p>}
                {promoError && <p className="hint" style={{ color: "var(--igy-error-text)" }}>{promoError}</p>}
                {!promo && !promoError && <p className="hint">{s.promoFieldHint}</p>}
              </div>

              {stripeIds ? (
                <>
                  <div className="consent-box" style={{ background: "var(--igy-success-bg)", borderColor: "var(--igy-success-border)", color: "var(--igy-success-text)" }}>
                    ✓ {lang === "es" ? "Tarjeta guardada (sin cobro)." : "Card saved (no charge)."}
                  </div>
                  <div className="wizard-nav">
                    <button className="btn btn-ghost" onClick={() => setStep(STEP.REFERRAL)}>{s.back}</button>
                    <button className="btn btn-primary" onClick={() => setStep(STEP.PHONE)}>{s.continue}</button>
                  </div>
                </>
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
                <label>{s.recipientPhone} — {teenFirstName}</label>
                <input value={teenPhone} onChange={(e) => setTeenPhone(e.target.value)} placeholder="+1 555 123 4567" autoFocus />
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
                      !teenPhone.trim() || !primaryAttest || submitting || !validYear(teenBirthYear) ||
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
    // the real mechanism is pending counsel and deliberately not built.
    return (
      <div className="consent-box" style={{ borderColor: "var(--igy-caution-border)", background: "var(--igy-caution-bg)" }}>
        <strong>{s.enhancedTitle}</strong>
        <p style={{ margin: "6px 0" }}>{fillTpl(s.enhancedMsgTpl, { age: gate.min_age, country: gate.country ?? "" })}</p>
        <p className="hint" style={{ color: "var(--igy-caution-text)" }}>
          ⚠ TODO (pending counsel): {s.enhancedTodo}
          {gate.mechanism ? ` [required_consent_mechanism: ${gate.mechanism}]` : ""}
        </p>
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
