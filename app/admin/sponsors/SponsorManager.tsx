"use client";

import { useState } from "react";
import type { AdminSponsor } from "@/lib/sponsors";

const statusPill = (s: string) =>
  s === "active" ? "pill pill-on" : s === "expired" ? "pill pill-off" : "pill pill-warn";

const emptyForm = {
  name: "", logo_url: "", contact_email: "", start_date: "", end_date: "",
  vetting_notes: "", amount: "", billing_note: "",
};

export default function SponsorManager({
  initialSponsors,
  canManage,
}: {
  initialSponsors: AdminSponsor[];
  canManage: boolean;
}) {
  const [sponsors, setSponsors] = useState<AdminSponsor[]>(initialSponsors);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof form>(k: K, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  async function refresh() {
    const res = await fetch("/api/admin/sponsors");
    const data = await res.json();
    if (res.ok) setSponsors(data.sponsors);
  }

  function openNew() { setEditingId(null); setForm({ ...emptyForm }); setShowForm(true); }
  function openEdit(s: AdminSponsor) {
    setEditingId(s.id);
    setForm({
      name: s.name, logo_url: s.logo_url, contact_email: s.contact_email ?? "",
      start_date: s.start_date ?? "", end_date: s.end_date ?? "",
      vetting_notes: s.vetting_notes ?? "", amount: s.amount_cents != null ? String(s.amount_cents / 100) : "",
      billing_note: s.billing_note ?? "",
    });
    setShowForm(true);
  }

  async function submit() {
    setError(null); setBusy(true);
    try {
      const payload = {
        name: form.name, logo_url: form.logo_url,
        contact_email: form.contact_email || null,
        start_date: form.start_date || null, end_date: form.end_date || null,
        vetting_notes: form.vetting_notes || null,
        amount_cents: form.amount ? Math.round(Number(form.amount) * 100) : null,
        billing_note: form.billing_note || null,
      };
      const res = await fetch(editingId ? `/api/admin/sponsors/${editingId}` : "/api/admin/sponsors", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setShowForm(false); setForm({ ...emptyForm }); setEditingId(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally { setBusy(false); }
  }

  async function setStatus(id: string, status: string) {
    setError(null);
    const res = await fetch(`/api/admin/sponsors/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error || "Failed"); return; }
    setSponsors((cur) => cur.map((s) => (s.id === id ? data.sponsor : s)));
  }

  return (
    <>
      <div className="admin-head">
        <h1>Sponsors</h1>
        {canManage && (
          <button className="btn btn-primary" onClick={() => (showForm ? setShowForm(false) : openNew())}>
            {showForm ? "Cancel" : "+ Add sponsor"}
          </button>
        )}
      </div>
      <p className="muted" style={{ marginTop: -12, marginBottom: 20 }}>
        Faith-aligned organizations who underwrite the site. Every logo shows at the same size — no tiers. A sponsor is
        vetted first (pending → active), displays on the homepage rotator + <span className="mono">/sponsors</span> only
        while active and within its date window, and drops out automatically after its end date. The actual payment is a
        normal Stripe charge set up per sponsor; it counts as regular revenue (and toward the tithe) — this table is
        record-keeping, not a billing system.
      </p>

      {error && <div className="error">{error}</div>}

      {showForm && canManage && (
        <div className="card" style={{ marginBottom: 22 }}>
          <div className="row">
            <div className="field">
              <label>Organization name</label>
              <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Grace Episcopal Church" />
            </div>
            <div className="field">
              <label>Logo URL</label>
              <input value={form.logo_url} onChange={(e) => set("logo_url", e.target.value)} placeholder="https://… or data: URI" />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>Contact email (internal)</label>
              <input value={form.contact_email} onChange={(e) => set("contact_email", e.target.value)} placeholder="office@…" />
            </div>
            <div className="field">
              <label>Negotiated amount (USD, internal)</label>
              <input type="number" value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="optional" />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>Start date</label>
              <input type="date" value={form.start_date} onChange={(e) => set("start_date", e.target.value)} />
            </div>
            <div className="field">
              <label>End date (auto-expires after this)</label>
              <input type="date" value={form.end_date} onChange={(e) => set("end_date", e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label>Vetting notes (internal — brand-safety check, never public)</label>
            <textarea value={form.vetting_notes} onChange={(e) => set("vetting_notes", e.target.value)} rows={2} placeholder="Confirmed who they are; aligned with the mission." />
          </div>
          <div className="field">
            <label>Billing note (internal — e.g. one-time vs annual)</label>
            <input value={form.billing_note} onChange={(e) => set("billing_note", e.target.value)} placeholder="one-time / annual underwriting" />
          </div>
          <button className="btn btn-primary" onClick={submit} disabled={busy || !form.name.trim() || !form.logo_url.trim()}>
            {busy ? "Saving…" : editingId ? "Save changes" : "Add sponsor (pending review)"}
          </button>
          {!editingId && <p className="hint">New sponsors start as <strong>pending review</strong> — vet them, then Mark active to go live.</p>}
        </div>
      )}

      <div className="sim-scroll">
        <table className="table">
          <thead>
            <tr><th>Logo</th><th>Name</th><th>Window</th><th>Status</th><th>Vetting</th>{canManage && <th></th>}</tr>
          </thead>
          <tbody>
            {sponsors.length === 0 && (
              <tr><td colSpan={canManage ? 6 : 5} className="muted">No sponsors yet.</td></tr>
            )}
            {sponsors.map((s) => (
              <tr key={s.id}>
                <td><img src={s.logo_url} alt={s.name} style={{ maxHeight: 34, maxWidth: 90, objectFit: "contain", background: "#0b1830", borderRadius: 4 }} /></td>
                <td>{s.name}</td>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{s.start_date ?? "—"} → {s.end_date ?? "∞"}</td>
                <td><span className={statusPill(s.status)}>{s.status.replace("_", " ")}</span></td>
                <td className="muted" style={{ maxWidth: 200 }}>{s.vetting_notes ?? "—"}</td>
                {canManage && (
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 12, marginRight: 6 }} onClick={() => openEdit(s)}>Edit</button>
                    {s.status !== "active" && <button className="btn btn-primary" style={{ padding: "5px 10px", fontSize: 12, marginRight: 6 }} onClick={() => setStatus(s.id, "active")}>Mark active</button>}
                    {s.status !== "expired" && <button className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => setStatus(s.id, "expired")}>Expire</button>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ marginTop: 10 }}>
        A sponsor auto-drops from the site after its end date even if still marked active — the display filters by date.
        &ldquo;Expire&rdquo; is for pulling one early.
      </p>
    </>
  );
}
