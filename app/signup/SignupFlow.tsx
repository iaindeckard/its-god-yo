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
  PLANS, GROUP_BANDS, DM_ADDON, bandForCount, GROUP_CONTACT_THRESHOLD, REFERRAL_DISCOUNT,
} from "@/lib/plans";
import { submitConsent, normalizePhone, type ConsentResult } from "@/lib/consent";

const PK = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "";
let stripePromise: Promise<StripeJs | null> | null = null;
function getStripePromise() {
  if (!stripePromise && PK) stripePromise = loadStripe(PK);
  return stripePromise;
}

type PlanChoice = "individual" | "family" | "gift" | "group";

const STEP = { LANG: 0, PLAN: 1, RECIPIENT: 2, PLUSONE: 3, REFERRAL: 4, PAY: 5, PHONE: 6, DONE: 7 } as const;
const TOTAL_DOTS = 7;

const money = (n: number) => `$${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`;

export default function SignupFlow({
  initialLang,
  initialPlan,
}: {
  initialLang: Lang;
  initialPlan?: string;
}) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [step, setStep] = useState<number>(STEP.LANG);
  const s = t[lang];

  // plan
  const [planChoice, setPlanChoice] = useState<PlanChoice>(
    (["individual", "family", "gift", "group"].includes(initialPlan || "") ? initialPlan : "individual") as PlanChoice
  );
  const [individualInterval, setIndividualInterval] = useState<"month" | "year">("month");
  const [teenCount, setTeenCount] = useState<number>(25);

  // recipient / purchaser
  const [teenFirstName, setTeenFirstName] = useState("");
  const [purchaserEmail, setPurchaserEmail] = useState("");

  // plus-one (DM from Him)
  const [poEnabled, setPoEnabled] = useState(false);
  const [poHonorific, setPoHonorific] = useState("");
  const [poRelationship, setPoRelationship] = useState("");
  const [poGifterFirst, setPoGifterFirst] = useState("");
  const [poGifterLast, setPoGifterLast] = useState("");
  const [poRecipientName, setPoRecipientName] = useState("");
  const [poRecipientPhone, setPoRecipientPhone] = useState("");
  const [poAttest, setPoAttest] = useState(false);

  // referral
  const [referralInput, setReferralInput] = useState("");
  const [referralApplied, setReferralApplied] = useState(false);

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
  const discount = referralApplied ? baseAmount * REFERRAL_DISCOUNT : 0;

  function reset() {
    setStep(STEP.LANG);
    setResult(null);
    setError(null);
    setTeenFirstName(""); setPurchaserEmail(""); setTeenPhone(""); setPrimaryAttest(false);
    setPoEnabled(false); setPoAttest(false); setStripeIds(null); setReferralApplied(false); setReferralInput("");
    setPromo(null); setPromoInput(""); setPromoError(null);
  }

  async function applyPromo() {
    setPromoError(null);
    setPromoBusy(true);
    try {
      const res = await fetch("/api/promo/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: promoInput.trim() }),
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
        plan_key: resolved!.key,
        base_price_id: resolved!.price_id!,
        group_teen_count: planChoice === "group" ? teenCount : null,
        dm_addon: poEnabled,
        dm_addon_price_id: poEnabled ? DM_ADDON.price_id : null,
        referral_code: referralApplied ? referralInput.trim() : null,
        referral_discount_applied: referralApplied,
        promo_code: promo?.code ?? null,
        promo_promotion_code_id: promo?.promotion_code_id ?? null,
        purchaser_email: purchaserEmail.trim() || null,
        teen: { first_name: teenFirstName.trim(), phone: normalizePhone(teenPhone) },
        plus_one: poEnabled
          ? {
              gifter_first_name: poGifterFirst.trim(),
              gifter_last_name: poGifterLast.trim() || undefined,
              gifter_honorific: poHonorific || undefined,
              gifter_relationship: poRelationship || undefined,
              recipient_first_name: poRecipientName.trim() || undefined,
              recipient_phone: normalizePhone(poRecipientPhone),
              attestation_confirmed: poAttest,
            }
          : null,
        stripe: stripeIds ?? undefined,
      });
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
                <button className="btn btn-ghost" onClick={() => setStep(STEP.LANG)}>{s.back}</button>
                <button className="btn btn-primary" disabled={isGroupContact || !resolved} onClick={() => setStep(STEP.RECIPIENT)}>
                  {s.continue}
                </button>
              </div>
            </section>
          )}

          {/* ---------- 2. Recipient ---------- */}
          {step === STEP.RECIPIENT && (
            <section>
              <h2>{s.wRecipientTitle}</h2>
              <p className="muted">{s.wRecipientSub}</p>
              <div className="field" style={{ marginTop: 16 }}>
                <label>{s.recipientFirstName}</label>
                <input value={teenFirstName} onChange={(e) => setTeenFirstName(e.target.value)} autoFocus />
              </div>
              <div className="field">
                <label>{s.purchaserEmailLabel}</label>
                <input type="email" value={purchaserEmail} onChange={(e) => setPurchaserEmail(e.target.value)} />
              </div>
              <div className="wizard-nav">
                <button className="btn btn-ghost" onClick={() => setStep(STEP.PLAN)}>{s.back}</button>
                <button className="btn btn-primary" disabled={!teenFirstName.trim()} onClick={() => setStep(STEP.PLUSONE)}>
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
                  disabled={poEnabled && !(poGifterFirst.trim() && (poHonorific || poRelationship) && poRecipientPhone.trim() && poAttest)}
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
                <input
                  value={referralInput}
                  onChange={(e) => { setReferralInput(e.target.value); setReferralApplied(false); }}
                  placeholder="FRIEND10"
                />
                {referralApplied && <p className="hint" style={{ color: "var(--igy-blue)" }}>{s.referralApplied}</p>}
              </div>
              {!referralApplied && referralInput.trim() && (
                <button className="btn btn-ghost" onClick={() => setReferralApplied(true)}>{s.apply}</button>
              )}
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
                    <span>{s.referral} (−10%)</span>
                    <span>−{money(discount)}</span>
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
                {promoError && <p className="hint" style={{ color: "#a12626" }}>{promoError}</p>}
                {!promo && !promoError && <p className="hint">{s.promoFieldHint}</p>}
              </div>

              {stripeIds ? (
                <>
                  <div className="consent-box" style={{ background: "#eaf7ee", borderColor: "#bfe3c9", color: "#256b39" }}>
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
                  onDone={(ids) => { setStripeIds(ids); setStep(STEP.PHONE); }}
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
              <p className="eyebrow">{s.attestationHeading}</p>
              <div className="consent-box">{ATTESTATION[lang](teenFirstName.trim() || (lang === "es" ? "esta persona" : "them"))}</div>
              <p className="eyebrow">{s.disclosureHeading}</p>
              <div className="consent-box">{DISCLOSURE[lang](teenFirstName.trim() || (lang === "es" ? "Esta persona" : "They"))}</div>
              <label className="check">
                <input type="checkbox" checked={primaryAttest} onChange={(e) => setPrimaryAttest(e.target.checked)} />
                <span>{s.iConfirm}</span>
              </label>
              <div className="wizard-nav">
                <button className="btn btn-ghost" onClick={() => setStep(STEP.PAY)}>{s.back}</button>
                <button
                  className="btn btn-primary"
                  disabled={!teenPhone.trim() || !primaryAttest || submitting}
                  onClick={handleSubmit}
                >
                  {submitting ? s.submitting : s.submitSignup}
                </button>
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
