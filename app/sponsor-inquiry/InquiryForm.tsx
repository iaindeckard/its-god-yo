"use client";

import { useState } from "react";

/**
 * "Interested in sponsoring?" lead-capture form (locked copy). Short by design —
 * an invitation to a conversation, not an application. On submit it notifies
 * hello@itsgodyo.com and shows a simple confirmation with no promised response
 * time.
 */
export default function InquiryForm() {
  const [orgName, setOrgName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const valid = orgName.trim() && contactName.trim() && email.trim();

  async function submit() {
    setError(null); setBusy(true);
    try {
      const res = await fetch("/api/sponsor-inquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          org_name: orgName, contact_name: contactName, email, message: message || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Something went wrong");
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally { setBusy(false); }
  }

  return (
    <main style={{ maxWidth: 540, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Interested in sponsoring?</h1>
      <p className="muted" style={{ marginBottom: 24 }}>
        These are the churches, schools, and organizations who share our mission and help make it possible. If that
        sounds like you, tell us a little about your organization and we&rsquo;ll take it from there.
      </p>

      {done ? (
        <div className="card">
          <p className="strong" style={{ fontSize: 18, marginBottom: 6 }}>Thanks &mdash; we&rsquo;ll be in touch. 🙏</p>
          <p className="muted">We received your note and someone will follow up personally.</p>
          <a className="btn btn-ghost" href="/" style={{ marginTop: 16 }}>Back home</a>
        </div>
      ) : (
        <div className="card">
          {error && <div className="error">{error}</div>}
          <div className="field">
            <label>Organization name</label>
            <input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Grace Episcopal Church" />
          </div>
          <div className="field">
            <label>Contact name</label>
            <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Your name" />
          </div>
          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@organization.org" />
          </div>
          <div className="field">
            <label>A short message (optional)</label>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} placeholder="Tell us a bit about your organization and why this feels like a fit." />
          </div>
          <button className="btn btn-primary" onClick={submit} disabled={!valid || busy}>
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
      )}
    </main>
  );
}
