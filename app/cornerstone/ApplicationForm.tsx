"use client";

import { useState } from "react";
import SalutationSelect from "@/components/SalutationSelect";

/**
 * Public Cornerstone Partner application/enrollment form. Reuses the app's shared
 * form primitives (.card / .field / .row / .btn) and the sponsor-inquiry submit
 * pattern (fetch → JSON → confirmation card). Fields follow the spec; the church
 * record + a 'submitted' application are written by POST /api/cornerstone/apply.
 */

const PLAN_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Not sure yet, let's discuss" },
  { value: "group", label: "Group / church subscription" },
  { value: "family_annual", label: "Family subscription" },
  { value: "individual_annual", label: "Individual (annual)" },
  { value: "individual_monthly", label: "Individual (monthly)" },
];

const empty = {
  church_name: "", website: "", address: "", city: "", state_province: "", postal_code: "", country: "",
  denomination: "", estimated_attendance: "", estimated_youth_group_size: "",
  contact_name: "", contact_title: "", contact_email: "", contact_phone: "",
  existing_account_email: "", preferred_plan: "",
  public_recognition_opt_in: false, logo_display_opt_in: false,
  terms_agreed: false, authorization_confirmed: false,
  company_website_confirm: "", // honeypot — must stay empty
};

export default function ApplicationForm() {
  const [f, setF] = useState({ ...empty });
  // Structured multi-select honorific(s) for the contact — array, kept separate
  // from the flat string form object. The church application has no language
  // field, so options default to English-first (full combined list still shown).
  const [contactSalutation, setContactSalutation] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function set<K extends keyof typeof f>(k: K, v: (typeof f)[K]) { setF((s) => ({ ...s, [k]: v })); }

  const valid =
    f.church_name.trim() &&
    f.contact_name.trim() &&
    f.contact_email.trim() &&
    f.terms_agreed &&
    f.authorization_confirmed;

  async function submit() {
    setError(null); setBusy(true);
    try {
      const res = await fetch("/api/cornerstone/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...f, contact_salutation: contactSalutation }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Something went wrong. Please try again.");
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally { setBusy(false); }
  }

  if (done) {
    return (
      <main style={{ maxWidth: 620, margin: "0 auto", padding: "48px 24px" }}>
        <div className="card">
          <p className="strong" style={{ fontSize: 20, marginBottom: 6 }}>Application received. 🙏</p>
          <p className="muted">
            Thank you. We&rsquo;ve received your church&rsquo;s Cornerstone Partner application. Our team reviews each
            one personally and will follow up at the email you provided.
          </p>
          <a className="btn btn-ghost" href="/" style={{ marginTop: 16 }}>Back home</a>
        </div>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "48px 24px" }}>
      <div style={{ maxWidth: 700, margin: "0 auto 36px", textAlign: "center" }}>
        <p className="strong" style={{ color: "var(--igy-blue)", letterSpacing: ".08em", fontSize: 13, marginBottom: 8 }}>FOR CHURCHES &amp; YOUTH GROUPS</p>
        <h1 style={{ fontSize: 36, lineHeight: 1.15, marginBottom: 12 }}>Keep Scripture present between Sundays.</h1>
        <p className="muted" style={{ fontSize: 17, lineHeight: 1.65, marginBottom: 20 }}>
          Give every participating teen one short, human-reviewed Scripture message each day. No app to download,
          and every recipient confirms for themselves before anything begins.
        </p>
        <a className="btn btn-primary" href="#apply">Talk with us about your group</a>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14, marginBottom: 28 }}>
        {[
          ["Simple enrollment", "Your church receives an attributed enrollment link. Families and teens complete the required consent flow directly."],
          ["Human-reviewed content", "Every public message comes from the approved content pool and remains grounded in the King James Version."],
          ["No app required", "Messages arrive by text, so participation does not depend on another login, download, or notification setting."],
        ].map(([title, body]) => (
          <div className="card" key={title} style={{ padding: 20 }}>
            <h2 style={{ fontSize: 17, marginBottom: 8 }}>{title}</h2>
            <p className="muted" style={{ fontSize: 14, lineHeight: 1.55 }}>{body}</p>
          </div>
        ))}
      </div>

      <div className="card" style={{ maxWidth: 700, margin: "0 auto 38px", padding: 22 }}>
        <h2 style={{ fontSize: 20, marginBottom: 8 }}>Group pricing</h2>
        <p className="muted" style={{ marginBottom: 12 }}>Annual price per participating teen. Start with the group you have; there is no need to enroll the whole congregation.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
          <div><strong>1–50 teens</strong><br /><span className="muted">$28 / teen / year</span></div>
          <div><strong>51–150 teens</strong><br /><span className="muted">$32 / teen / year</span></div>
          <div><strong>151–300 teens</strong><br /><span className="muted">$36 / teen / year</span></div>
          <div><strong>301+</strong><br /><span className="muted">Let&rsquo;s design the rollout</span></div>
        </div>
      </div>

      <div id="apply" style={{ maxWidth: 620, margin: "0 auto" }}>
      <h2 style={{ fontSize: 28, marginBottom: 8 }}>Start the conversation</h2>
      <p className="muted" style={{ marginBottom: 24 }}>
        Send the essentials first. We&rsquo;ll review your note personally and follow up about enrollment, recognition, and rollout.
      </p>

      {error && <div className="error" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="card">
        {/* Honeypot — visually hidden, not announced to real users. */}
        <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}>
          <label>Company website (leave blank)
            <input tabIndex={-1} autoComplete="off" value={f.company_website_confirm}
              onChange={(e) => set("company_website_confirm", e.target.value)} />
          </label>
        </div>

        <h2 style={{ fontSize: 16, margin: "4px 0 12px" }}>Church</h2>
        <div className="field">
          <label>Church name *</label>
          <input value={f.church_name} onChange={(e) => set("church_name", e.target.value)} placeholder="Grace Episcopal Church" />
        </div>
        <div className="field">
          <label>Estimated youth group size</label>
          <input type="number" min={0} value={f.estimated_youth_group_size} onChange={(e) => set("estimated_youth_group_size", e.target.value)} />
        </div>

        <details style={{ marginBottom: 20 }}>
          <summary style={{ cursor: "pointer", fontSize: 14, color: "var(--igy-muted)" }}>Add optional church details</summary>
          <div style={{ marginTop: 14 }}>
            <div className="field"><label>Church website</label><input value={f.website} onChange={(e) => set("website", e.target.value)} placeholder="https://…" /></div>
            <div className="field"><label>Address</label><input value={f.address} onChange={(e) => set("address", e.target.value)} placeholder="123 Main St" /><p className="hint">Used only to show your church&rsquo;s approximate location on our public partner map. Never sold, never used to mail you.</p></div>
            <div className="row">
              <div className="field"><label>City</label><input value={f.city} onChange={(e) => set("city", e.target.value)} /></div>
              <div className="field"><label>State / province</label><input value={f.state_province} onChange={(e) => set("state_province", e.target.value)} /></div>
            </div>
            <div className="row">
              <div className="field"><label>Postal code</label><input value={f.postal_code} onChange={(e) => set("postal_code", e.target.value)} /></div>
              <div className="field"><label>Country</label><input value={f.country} onChange={(e) => set("country", e.target.value)} placeholder="United States" /></div>
            </div>
            <div className="row">
              <div className="field"><label>Denomination</label><input value={f.denomination} onChange={(e) => set("denomination", e.target.value)} /></div>
              <div className="field"><label>Estimated attendance</label><input type="number" min={0} value={f.estimated_attendance} onChange={(e) => set("estimated_attendance", e.target.value)} /></div>
            </div>
          </div>
        </details>

        <h2 style={{ fontSize: 16, margin: "20px 0 12px" }}>Primary contact</h2>
        <div className="row">
          <div className="field"><label>Contact name *</label><input value={f.contact_name} onChange={(e) => set("contact_name", e.target.value)} /></div>
          <div className="field"><label>Role / title</label><input value={f.contact_title} onChange={(e) => set("contact_title", e.target.value)} placeholder="Youth Pastor" /></div>
          <details style={{ width: "100%" }}>
            <summary style={{ cursor: "pointer", fontSize: 14, color: "var(--igy-muted)" }}>Add a salutation (optional)</summary>
            <div style={{ marginTop: 12 }}>
              <SalutationSelect lang="en" value={contactSalutation} onChange={setContactSalutation} label="Salutation / honorific(s)" hint="Combine titles if needed (e.g. Rev. Dr.)." />
            </div>
          </details>
        </div>
        <div className="row">
          <div className="field"><label>Email *</label><input type="email" value={f.contact_email} onChange={(e) => set("contact_email", e.target.value)} placeholder="you@church.org" /></div>
          <div className="field"><label>Phone (optional)</label><input value={f.contact_phone} onChange={(e) => set("contact_phone", e.target.value)} /></div>
        </div>
        <div className="field">
          <label>Existing It&rsquo;s God, Yo! account (if any)</label>
          <input type="email" value={f.existing_account_email} onChange={(e) => set("existing_account_email", e.target.value)} placeholder="Email on your existing account, if applicable" />
        </div>
        <div className="field">
          <label>Preferred subscription plan</label>
          <select value={f.preferred_plan} onChange={(e) => set("preferred_plan", e.target.value)}>
            {PLAN_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>

        <h2 style={{ fontSize: 16, margin: "20px 0 12px" }}>Recognition &amp; agreement</h2>
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 12 }}>
          <input type="checkbox" checked={f.public_recognition_opt_in} onChange={(e) => set("public_recognition_opt_in", e.target.checked)} style={{ marginTop: 3 }} />
          <span>Our church gives permission to be publicly recognized on the Cornerstone Partners page.</span>
        </label>
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 12 }}>
          <input type="checkbox" checked={f.logo_display_opt_in} onChange={(e) => set("logo_display_opt_in", e.target.checked)} style={{ marginTop: 3 }} />
          <span>Our church gives permission to display our logo alongside that recognition.</span>
        </label>
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 12 }}>
          <input type="checkbox" checked={f.terms_agreed} onChange={(e) => set("terms_agreed", e.target.checked)} style={{ marginTop: 3 }} />
          <span>I agree to the <a href="/program-terms#cornerstone-partner-program" target="_blank" rel="noopener noreferrer">Cornerstone Partner terms</a>. *</span>
        </label>
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 16 }}>
          <input type="checkbox" checked={f.authorization_confirmed} onChange={(e) => set("authorization_confirmed", e.target.checked)} style={{ marginTop: 3 }} />
          <span>I confirm I am authorized to act on behalf of this church. *</span>
        </label>

        <button className="btn btn-primary" onClick={submit} disabled={!valid || busy}>
          {busy ? "Submitting…" : "Submit application"}
        </button>
        <p className="hint" style={{ marginTop: 10 }}>Fields marked * are required.</p>
      </div>
      </div>
    </main>
  );
}
