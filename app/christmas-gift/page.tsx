"use client";

import { useEffect, useMemo, useState } from "react";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import SalutationSelect from "@/components/SalutationSelect";

/**
 * Christmas Scheduled Gift 2026 — buyer checkout page.
 *
 * Prepaid one-year gift: charged today, recipient confirmation text scheduled for a
 * future date the buyer picks. The offer shown here is fetched from /status (the same
 * resolveWindow the charge uses) so the banner NEVER disagrees with what is charged.
 * Required pre-pay disclosures are rendered prominently before the pay button.
 *
 * English-only for v1 (recipient language en/es is still collected for their sends).
 * Spanish localization of the buyer UI is deferred.
 */

const PK = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "";
let stripePromise: Promise<StripeJs | null> | null = null;
function getStripePromise() {
  if (!stripePromise && PK) stripePromise = loadStripe(PK);
  return stripePromise;
}

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

type PurchaseWindow = "early_bird" | "flash_sale" | "standard";
interface Status {
  open: boolean;
  reason?: string;
  window?: PurchaseWindow;
  list_price_cents?: number;
  charged_amount_cents?: number;
  dmfh_bonus?: boolean;
  max_release_at?: string | null;
}

interface Details {
  purchaser_email: string;
  purchaser_first_name: string;
  purchaser_last_name: string;
  purchaser_salutation: string[];
  gifter_first_name: string;
  gifter_last_name: string;
  gifter_honorific: string;
  gifter_relationship: string;
  recipient_first_name: string;
  recipient_phone: string;
  recipient_country_code: string;
  recipient_birth_year: string;
  language: "en" | "es";
  release_at: string;
  referral_code: string;
}

const EMPTY: Details = {
  purchaser_email: "",
  purchaser_first_name: "",
  purchaser_last_name: "",
  purchaser_salutation: [],
  gifter_first_name: "",
  gifter_last_name: "",
  gifter_honorific: "",
  gifter_relationship: "",
  recipient_first_name: "",
  recipient_phone: "",
  recipient_country_code: "US",
  recipient_birth_year: "",
  language: "en",
  release_at: "",
  referral_code: "",
};

/** Window-accurate offer line. Must match what the charge will be. */
function offerLine(st: Status): string {
  if (!st.open || st.charged_amount_cents == null || st.list_price_cents == null) return "";
  if (st.window === "flash_sale") {
    const pct = Math.round((1 - st.charged_amount_cents / st.list_price_cents) * 100);
    return `Black Friday special: ${pct}% off (${money(st.charged_amount_cents)}), and DM from Him is included free. Refer someone else to buy a gift too and you get double the usual referral reward, through the end of the sale.`;
  }
  if (st.window === "early_bird") {
    return `Early bird: ${money(st.charged_amount_cents)}, and your recipient's gifted year includes DM from Him free when you buy by Thanksgiving Day.`;
  }
  return `${money(st.charged_amount_cents)} for a full prepaid year.`;
}

function Disclosures({ st }: { st: Status }) {
  return (
    <div className="consent-box" style={{ fontSize: 14, lineHeight: 1.5 }}>
      <strong>Before you pay, please read:</strong>
      <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
        <li>This is a prepaid one-year gift. Your card is charged today.</li>
        <li>The confirmation text to your recipient is scheduled for the date you choose, not sent immediately.</li>
        <li>There is no free trial on this purchase.</li>
        <li>This purchase is not eligible for a cash refund.</li>
        <li>
          If your recipient never confirms by replying YES, your payment converts to It&apos;s God, Yo! account
          credit instead of a refund.
        </li>
        <li>Your recipient&apos;s one year of daily messages begins only after they reply YES to confirm.</li>
        <li>
          If your recipient does not meet the age or consent requirements for their country, we will not text
          them and your payment converts to account credit instead.
        </li>
      </ul>
      {offerLine(st) && <p style={{ margin: "10px 0 0" }}>{offerLine(st)}</p>}
    </div>
  );
}

export default function ChristmasGiftPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [d, setD] = useState<Details>(EMPTY);
  const [step, setStep] = useState<"details" | "pay" | "done">("details");
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/christmas-gift/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ open: false, reason: "unreachable" }));
  }, []);

  const set = <K extends keyof Details>(k: K, v: Details[K]) => setD((p) => ({ ...p, [k]: v }));

  const tomorrow = useMemo(() => {
    const dt = new Date();
    dt.setDate(dt.getDate() + 1);
    return dt.toISOString().slice(0, 10);
  }, []);

  async function submitDetails() {
    setErr(null);
    if (!d.purchaser_email.trim()) return setErr("Please enter your email.");
    if (!d.recipient_first_name.trim()) return setErr("Please enter your recipient's first name.");
    if (!d.recipient_phone.trim()) return setErr("Please enter your recipient's mobile number.");
    const by = Number(d.recipient_birth_year);
    if (!d.recipient_birth_year || !Number.isInteger(by) || by < 1900 || by > new Date().getFullYear()) {
      return setErr("Please enter your recipient's birth year.");
    }
    if (!d.release_at) return setErr("Please choose a date to send the gift.");
    setBusy(true);
    try {
      const res = await fetch("/api/christmas-gift/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...d,
          recipient_birth_year: d.recipient_birth_year ? Number(d.recipient_birth_year) : undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        setErr(humanError(j.error));
        setBusy(false);
        return;
      }
      setClientSecret(j.client_secret);
      setStep("pay");
    } catch (e) {
      setErr(String(e));
    }
    setBusy(false);
  }

  if (!status) return <main className="container"><p>Loading…</p></main>;

  if (!status.open) {
    return (
      <main className="container" style={{ maxWidth: 640 }}>
        <h1>Christmas Gift</h1>
        <p className="muted">This Christmas gift offering isn&apos;t open right now. It&apos;s one of several seasonal offerings we run throughout the year. Check back soon.</p>
      </main>
    );
  }

  return (
    <main className="container" style={{ maxWidth: 640 }}>
      <h1>Give a Christmas Gift</h1>
      <p className="muted">A full prepaid year of daily Scripture texts, scheduled to arrive whenever you choose. This is one of our seasonal offerings; we run others throughout the year.</p>

      {step === "details" && (
        <>
          <section style={{ display: "grid", gap: 10, marginTop: 12 }}>
            <h3>Your info</h3>
            <input placeholder="Your email (for the receipt)" type="email" value={d.purchaser_email} onChange={(e) => set("purchaser_email", e.target.value)} />
            <div className="row" style={{ gap: 8 }}>
              <input placeholder="Your first name" value={d.purchaser_first_name} onChange={(e) => set("purchaser_first_name", e.target.value)} />
              <input placeholder="Your last name" value={d.purchaser_last_name} onChange={(e) => set("purchaser_last_name", e.target.value)} />
            </div>
            <SalutationSelect lang={d.language} value={d.purchaser_salutation} onChange={(v) => set("purchaser_salutation", v)} />

            <h3 style={{ marginTop: 8 }}>Who is this gift from?</h3>
            <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>Used so your recipient&apos;s first text can say who sent it.</p>
            <div className="row" style={{ gap: 8 }}>
              <input placeholder="From (first name)" value={d.gifter_first_name} onChange={(e) => set("gifter_first_name", e.target.value)} />
              <input placeholder="From (last name)" value={d.gifter_last_name} onChange={(e) => set("gifter_last_name", e.target.value)} />
            </div>
            <div className="row" style={{ gap: 8 }}>
              <input placeholder="Title (e.g. Aunt, Pastor)" value={d.gifter_honorific} onChange={(e) => set("gifter_honorific", e.target.value)} />
              <input placeholder="Relationship (e.g. your aunt)" value={d.gifter_relationship} onChange={(e) => set("gifter_relationship", e.target.value)} />
            </div>

            <h3 style={{ marginTop: 8 }}>Your recipient</h3>
            <input placeholder="Recipient first name" value={d.recipient_first_name} onChange={(e) => set("recipient_first_name", e.target.value)} />
            <input placeholder="Recipient mobile number" value={d.recipient_phone} onChange={(e) => set("recipient_phone", e.target.value)} />
            <div className="row" style={{ gap: 8 }}>
              <select value={d.recipient_country_code} onChange={(e) => set("recipient_country_code", e.target.value)}>
                <option value="US">United States</option>
                <option value="MX">Mexico</option>
                <option value="CA">Canada</option>
              </select>
              <select value={d.language} onChange={(e) => set("language", e.target.value as "en" | "es")}>
                <option value="en">Messages in English</option>
                <option value="es">Messages in Spanish</option>
              </select>
            </div>
            <input placeholder="Recipient birth year (required)" inputMode="numeric" required value={d.recipient_birth_year} onChange={(e) => set("recipient_birth_year", e.target.value.replace(/\D/g, "").slice(0, 4))} />
            <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>Required. Used to confirm age eligibility before we text your recipient.</p>

            <h3 style={{ marginTop: 8 }}>When should we send it?</h3>
            <input type="date" min={tomorrow} max={status.max_release_at ?? undefined} value={d.release_at} onChange={(e) => set("release_at", e.target.value)} />

            <input placeholder="Referral code (optional)" value={d.referral_code} onChange={(e) => set("referral_code", e.target.value)} />
          </section>

          <div style={{ marginTop: 14 }}>
            <Disclosures st={status} />
          </div>

          {err && <div className="error" style={{ marginTop: 10 }}>{err}</div>}
          <div className="wizard-nav" style={{ marginTop: 12 }}>
            <span />
            <button className="btn btn-primary" onClick={submitDetails} disabled={busy}>
              {busy ? "Preparing checkout…" : "Continue to payment"}
            </button>
          </div>
        </>
      )}

      {step === "pay" && clientSecret && (
        <>
          <div style={{ marginTop: 12 }}>
            <Disclosures st={status} />
          </div>
          <p style={{ marginTop: 10 }}>
            <strong>You will be charged {money(status.charged_amount_cents!)} today.</strong>
          </p>
          <Elements
            stripe={getStripePromise()}
            options={{ clientSecret, appearance: { theme: "flat", variables: { colorPrimary: "#378ADD", borderRadius: "12px" } } }}
          >
            <PayForm amountCents={status.charged_amount_cents!} onBack={() => setStep("details")} onDone={() => setStep("done")} />
          </Elements>
        </>
      )}

      {step === "done" && (
        <section style={{ marginTop: 16 }}>
          <h2>Your gift is scheduled.</h2>
          <p>
            Payment received. On {d.release_at}, we will text {d.recipient_first_name || "your recipient"} to
            confirm. Their year of daily messages begins only after they reply YES. A receipt is on its way to
            {" "}{d.purchaser_email}.
          </p>
        </section>
      )}
    </main>
  );
}

function PayForm({ amountCents, onBack, onDone }: { amountCents: number; onBack: () => void; onDone: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function pay() {
    if (!stripe || !elements) return;
    setBusy(true);
    setErr(null);
    const { error, paymentIntent } = await stripe.confirmPayment({ elements, redirect: "if_required" });
    if (error) {
      setErr(error.message || "Card error");
      setBusy(false);
      return;
    }
    if (paymentIntent && (paymentIntent.status === "succeeded" || paymentIntent.status === "processing")) {
      onDone();
      return;
    }
    setErr("Payment could not be completed. Please try again.");
    setBusy(false);
  }

  return (
    <div>
      <div style={{ margin: "8px 0 4px" }}>
        <PaymentElement />
      </div>
      {err && <div className="error">{err}</div>}
      <div className="wizard-nav">
        <button className="btn btn-ghost" onClick={onBack} disabled={busy}>Back</button>
        <button className="btn btn-primary" onClick={pay} disabled={busy || !stripe}>
          {busy ? "Processing…" : `Pay ${money(amountCents)}`}
        </button>
      </div>
    </div>
  );
}

/** Map server fail-closed reasons to buyer-friendly text. */
function humanError(reason: string | undefined): string {
  switch (reason) {
    case "campaign_inactive":
    case "sale_not_open":
      return "This Christmas gift offering isn't open right now.";
    case "campaign_closed":
      return "This Christmas gift offering has closed for this year. We'll have more seasonal offerings throughout the year.";
    case "release_date_not_future":
      return "Please choose a send date in the future.";
    case "release_date_after_max":
      return "Please choose a send date on or before the latest allowed date.";
    case "release_date_malformed":
    case "release_date_invalid":
      return "Please choose a valid send date.";
    case "purchaser_email_required":
      return "Please enter your email.";
    case "recipient_phone_required":
      return "Please enter your recipient's mobile number.";
    case "recipient_birth_year_required":
      return "Please enter your recipient's birth year.";
    case "recipient_birth_year_invalid":
      return "Please enter a valid birth year.";
    default:
      return reason ? `We could not start checkout (${reason}).` : "We could not start checkout.";
  }
}
