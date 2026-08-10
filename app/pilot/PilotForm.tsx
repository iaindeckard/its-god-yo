"use client";

import { FormEvent, useState } from "react";

export default function PilotForm({ initialAudience = "family" }: { initialAudience?: "family" | "church" }) {
  const [audience, setAudience] = useState(initialAudience);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setMessage("");
    const values = Object.fromEntries(new FormData(e.currentTarget));
    const res = await fetch("/api/pilot-interest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...values, audience_type: audience }) });
    const data = await res.json().catch(() => ({}));
    setMessage(res.ok ? "You’re on the pilot interest list. We’ll review fit before enrollment." : data.error || "Please try again.");
    setBusy(false);
  }
  return <form className="card" onSubmit={submit} style={{ display: "grid", gap: 14 }}>
    <div className="row">
      <button type="button" className={audience === "family" ? "btn btn-primary" : "btn"} onClick={() => setAudience("family")}>Family</button>
      <button type="button" className={audience === "church" ? "btn btn-primary" : "btn"} onClick={() => setAudience("church")}>Church pilot</button>
    </div>
    <label className="field">Your name *<input name="contact_name" required maxLength={120} /></label>
    <label className="field">Email *<input name="contact_email" type="email" required maxLength={254} /></label>
    {audience === "church" && <label className="field">Church or organization<input name="organization_name" maxLength={160} /></label>}
    <label className="field">Estimated recipients<input name="estimated_recipients" type="number" min={1} max={250} defaultValue={audience === "church" ? 15 : 1} /></label>
    <button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Request pilot access"}</button>
    {message && <p aria-live="polite">{message}</p>}
  </form>;
}
