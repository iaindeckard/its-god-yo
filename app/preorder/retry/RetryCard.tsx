"use client";

import { useState } from "react";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";

const PK = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "";
let stripePromise: Promise<StripeJs | null> | null = null;
function getStripePromise() {
  if (!stripePromise && PK) stripePromise = loadStripe(PK);
  return stripePromise;
}

type Outcome = "idle" | "active" | "declined";

export default function RetryCard({ ps, t, clientSecret }: { ps: string; t: string; clientSecret: string }) {
  if (!PK) {
    return <div style={{ color: "#f3b0b0" }}>Payment isn&rsquo;t configured. Please contact support.</div>;
  }
  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Update your card</h1>
      <p style={{ color: "#a9bad6", fontSize: 14, lineHeight: 1.6, marginBottom: 18 }}>
        We couldn&rsquo;t process your card. Enter a new one below to activate your daily Good News —
        we&rsquo;ll charge it as soon as you submit.
      </p>
      <Elements
        stripe={getStripePromise()}
        options={{ clientSecret, appearance: { theme: "night", variables: { colorPrimary: "#378ADD", borderRadius: "12px" } } }}
      >
        <Inner ps={ps} t={t} />
      </Elements>
    </div>
  );
}

function Inner({ ps, t }: { ps: string; t: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>("idle");

  async function submit() {
    if (!stripe || !elements) return;
    setBusy(true);
    setErr(null);
    // 1) Save the new card (confirm the SetupIntent).
    const { error, setupIntent } = await stripe.confirmSetup({ elements, redirect: "if_required" });
    if (error) {
      setErr(error.message || "Card error");
      setBusy(false);
      return;
    }
    const pm = setupIntent?.payment_method;
    const pmId = typeof pm === "string" ? pm : pm?.id;
    if (!pmId) {
      setErr("Couldn't save the card. Please try again.");
      setBusy(false);
      return;
    }
    // 2) Ask the server to re-attempt the charge with the new card.
    try {
      const r = await fetch("/api/preorder/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ps, t, payment_method_id: pmId }),
      });
      const d = await r.json();
      if (d.status === "active") setOutcome("active");
      else if (d.status === "payment_failed") setOutcome("declined");
      else setErr(d.error || d.detail || "Something went wrong. Please try again.");
    } catch {
      setErr("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (outcome === "active") {
    return (
      <div style={{ textAlign: "center", padding: "10px 0" }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>✓</div>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>You&rsquo;re all set!</h2>
        <p style={{ color: "#a9bad6", fontSize: 14, lineHeight: 1.6 }}>
          Your card went through and your daily Good News is active. 🙏
        </p>
        <p style={{ marginTop: 18 }}><a href="/" style={{ color: "#7ea8e0", fontSize: 14 }}>&larr; Back home</a></p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ margin: "8px 0" }}>
        <PaymentElement />
      </div>
      {outcome === "declined" && (
        <div style={{ background: "rgba(180,35,42,0.15)", border: "1px solid #b4232a", color: "#f3b0b0", borderRadius: 10, padding: "10px 12px", fontSize: 14, margin: "10px 0" }}>
          That card was also declined. Please try a different card.
        </div>
      )}
      {err && (
        <div style={{ background: "rgba(180,35,42,0.15)", border: "1px solid #b4232a", color: "#f3b0b0", borderRadius: 10, padding: "10px 12px", fontSize: 14, margin: "10px 0" }}>
          {err}
        </div>
      )}
      <button
        onClick={submit}
        disabled={busy || !stripe}
        style={{ width: "100%", marginTop: 12, background: "#378ADD", color: "#fff", border: "none", borderRadius: 12, padding: "13px 20px", fontWeight: 600, fontSize: 15, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}
      >
        {busy ? "Processing…" : "Update card & activate"}
      </button>
    </div>
  );
}
