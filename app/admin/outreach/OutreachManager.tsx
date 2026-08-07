"use client";

import { useState } from "react";

// Local view types (mirroring the server models; kept local so this client
// component never imports the server-only lib modules).
type SizeBucket = "small" | "medium" | "large" | "mega" | "unknown";
const BUCKETS: SizeBucket[] = ["small", "medium", "large", "mega", "unknown"];
const BUCKET_LABEL: Record<SizeBucket, string> = {
  small: "Small (<100)", medium: "Medium (100–499)", large: "Large (500–1,999)",
  mega: "Mega (2,000+)", unknown: "Unknown",
};

interface Campaign {
  id: string; name: string; center_label: string;
  center_lat: number | null; center_lng: number | null;
  radius_miles: number; size_filter: string[] | null;
  status: string; created_at: string;
}
interface Lead {
  id: string; org_name: string; city: string | null; state: string | null;
  contact_email: string; website: string | null; status: string;
  discovery_confidence: string | null; size_bucket: SizeBucket;
  estimated_attendance: number | null; attendance_source_url: string | null;
  send_count: number; last_sent_at: string | null; promo_code: string | null;
}
interface SendItem { org_name: string; to: string; outcome: string; touch: number | null; promo_code: string; subject: string; }
interface SendReport {
  mode: string; gate_reasons: string[]; scanned: number; sent: number;
  would_send: number; not_due: number; complete: number; skipped: number; errors: number;
  items: SendItem[];
}

const statusPill = (s: string) =>
  s === "active" ? "pill pill-on"
  : s === "converted" ? "pill pill-on"
  : s === "staged" ? "pill pill-warn"
  : s === "needs_review" ? "pill pill-warn"
  : "pill pill-off";

export default function OutreachManager({
  initialCampaigns, canManage,
}: { initialCampaigns: Campaign[]; canManage: boolean }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>(initialCampaigns);
  const [selected, setSelected] = useState<Campaign | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [viewBucket, setViewBucket] = useState<"all" | SizeBucket>("all");
  const [promoteSel, setPromoteSel] = useState<Set<SizeBucket>>(new Set());
  const [report, setReport] = useState<SendReport | null>(null);
  const [form, setForm] = useState({ name: "", center_label: "", radius_miles: "50" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refreshCampaigns() {
    const res = await fetch("/api/admin/outreach/campaigns");
    const data = await res.json();
    if (res.ok) setCampaigns(data.campaigns);
  }

  async function openCampaign(c: Campaign) {
    setSelected(c); setLeads([]); setReport(null); setViewBucket("all"); setPromoteSel(new Set());
    const res = await fetch(`/api/admin/outreach/campaigns/${c.id}`);
    const data = await res.json();
    if (res.ok) { setSelected(data.campaign); setLeads(data.leads); }
    else setError(data.error || "failed to load campaign");
  }

  async function createCampaign() {
    setError(null); setBusy("create");
    try {
      const res = await fetch("/api/admin/outreach/campaigns", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name, center_label: form.center_label, radius_miles: Number(form.radius_miles),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "create failed");
      setForm({ name: "", center_label: "", radius_miles: "50" });
      await refreshCampaigns();
      await openCampaign(data.campaign);
    } catch (e) { setError(e instanceof Error ? e.message : "create failed"); }
    finally { setBusy(null); }
  }

  async function runDiscovery() {
    if (!selected) return;
    setError(null); setBusy("discover");
    try {
      const res = await fetch(`/api/admin/outreach/campaigns/${selected.id}/discover`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "discovery failed");
      if (data.result && data.result.ran === false) setError(`Discovery no-op: ${data.result.reason} (set ANTHROPIC_API_KEY).`);
      await openCampaign(selected);
      await refreshCampaigns();
    } catch (e) { setError(e instanceof Error ? e.message : "discovery failed"); }
    finally { setBusy(null); }
  }

  async function promote() {
    if (!selected || promoteSel.size === 0) return;
    setError(null); setBusy("promote");
    try {
      const res = await fetch(`/api/admin/outreach/campaigns/${selected.id}/promote`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ sizeBuckets: [...promoteSel] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "promote failed");
      setPromoteSel(new Set());
      await openCampaign(selected);
    } catch (e) { setError(e instanceof Error ? e.message : "promote failed"); }
    finally { setBusy(null); }
  }

  async function send(live: boolean) {
    if (!selected) return;
    if (live && !confirm("Send LIVE to this campaign's active leads? This puts real email in front of real churches (subject to the send gate).")) return;
    setError(null); setBusy(live ? "send-live" : "send-dry"); setReport(null);
    try {
      const res = await fetch(`/api/admin/outreach/campaigns/${selected.id}/send`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ dry: !live }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "send failed");
      setReport(data.report);
      await openCampaign(selected);
    } catch (e) { setError(e instanceof Error ? e.message : "send failed"); }
    finally { setBusy(null); }
  }

  const shown = viewBucket === "all" ? leads : leads.filter((l) => l.size_bucket === viewBucket);
  const stagedByBucket = (b: SizeBucket) => leads.filter((l) => l.size_bucket === b && l.status === "staged").length;

  return (
    <div>
      <div className="admin-head">
        <h1>Outreach campaigns</h1>
        <p className="muted">Geographic-scoped church discovery, size segmentation, and isolated per-campaign sends.</p>
      </div>

      {error && <div className="card" style={{ borderColor: "var(--igy-danger, #c0392b)", color: "#c0392b" }}>{error}</div>}

      {/* Create */}
      {canManage && (
        <div className="card">
          <div className="row">
            <div className="field"><label>Name</label>
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Dallas Metro 50mi" /></div>
            <div className="field"><label>Center (place)</label>
              <input value={form.center_label} onChange={(e) => setForm((f) => ({ ...f, center_label: e.target.value }))} placeholder="Dallas, TX" /></div>
            <div className="field"><label>Radius (miles)</label>
              <input type="number" min={1} value={form.radius_miles} onChange={(e) => setForm((f) => ({ ...f, radius_miles: e.target.value }))} style={{ width: 110 }} /></div>
            <button className="btn btn-primary" disabled={busy === "create"} onClick={createCampaign}>
              {busy === "create" ? "Creating…" : "Create campaign"}</button>
          </div>
          <p className="hint">The center is geocoded on create (keyless Nominatim). Phase 2 adds the interactive map picker.</p>
        </div>
      )}

      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* Campaign list */}
        <div className="card" style={{ flex: "0 0 300px" }}>
          <h3>Campaigns</h3>
          {campaigns.length === 0 && <p className="muted">No campaigns yet.</p>}
          {campaigns.map((c) => (
            <button key={c.id} className="btn btn-ghost" style={{ display: "block", width: "100%", textAlign: "left", marginBottom: 6, fontWeight: selected?.id === c.id ? 700 : 400 }} onClick={() => openCampaign(c)}>
              {c.name} <span className={statusPill(c.status)} style={{ marginLeft: 6 }}>{c.status}</span>
              <div className="muted" style={{ fontSize: 12 }}>{c.center_label} · {Number(c.radius_miles)}mi{c.center_lat == null ? " · ⚠ not geocoded" : ""}</div>
            </button>
          ))}
        </div>

        {/* Detail */}
        <div className="card" style={{ flex: "1 1 520px" }}>
          {!selected && <p className="muted">Select a campaign to view its leads.</p>}
          {selected && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
                <h3 style={{ margin: 0 }}>{selected.name}</h3>
                <span className="muted">{selected.center_label} · {Number(selected.radius_miles)}mi · {leads.length} leads</span>
              </div>

              {canManage && (
                <div className="row" style={{ margin: "12px 0", gap: 8, flexWrap: "wrap" }}>
                  <button className="btn btn-primary" disabled={busy === "discover"} onClick={runDiscovery}>
                    {busy === "discover" ? "Discovering…" : "Run discovery"}</button>
                  <button className="btn btn-ghost" disabled={!!busy} onClick={() => send(false)}>
                    {busy === "send-dry" ? "Previewing…" : "Preview send (dry-run)"}</button>
                  <button className="btn btn-ghost" disabled={!!busy} onClick={() => send(true)} style={{ borderColor: "#c0392b", color: "#c0392b" }}>
                    {busy === "send-live" ? "Sending…" : "Send live"}</button>
                </div>
              )}

              {/* Promote */}
              {canManage && (
                <div style={{ margin: "10px 0", padding: "10px 12px", background: "var(--igy-panel, #f6faff)", borderRadius: 8 }}>
                  <strong style={{ fontSize: 13 }}>Promote staged leads → active (enters send pipeline)</strong>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "8px 0" }}>
                    {BUCKETS.map((b) => {
                      const n = stagedByBucket(b);
                      return (
                        <label key={b} style={{ fontSize: 13, opacity: n ? 1 : 0.4 }}>
                          <input type="checkbox" disabled={!n} checked={promoteSel.has(b)}
                            onChange={(e) => setPromoteSel((s) => { const n2 = new Set(s); e.target.checked ? n2.add(b) : n2.delete(b); return n2; })} />
                          {" "}{BUCKET_LABEL[b]} ({n} staged)
                        </label>
                      );
                    })}
                  </div>
                  <button className="btn btn-primary" disabled={promoteSel.size === 0 || busy === "promote"} onClick={promote}>
                    {busy === "promote" ? "Promoting…" : "Promote selected"}</button>
                </div>
              )}

              {/* Size view filter */}
              <div className="row" style={{ margin: "10px 0" }}>
                <div className="field"><label>Filter by size</label>
                  <select value={viewBucket} onChange={(e) => setViewBucket(e.target.value as "all" | SizeBucket)}>
                    <option value="all">All sizes</option>
                    {BUCKETS.map((b) => <option key={b} value={b}>{BUCKET_LABEL[b]}</option>)}
                  </select>
                </div>
              </div>

              {/* Lead table */}
              <div className="sim-scroll">
                <table className="table">
                  <thead><tr>
                    <th>Church</th><th>Location</th><th>Size</th><th>Attendance</th><th>Confidence</th><th>Status</th><th>Sends</th>
                  </tr></thead>
                  <tbody>
                    {shown.length === 0 && <tr><td colSpan={7} className="muted">No leads{viewBucket !== "all" ? " in this size bucket" : ""}.</td></tr>}
                    {shown.map((l) => (
                      <tr key={l.id}>
                        <td>{l.website ? <a href={l.website} target="_blank" rel="noreferrer">{l.org_name}</a> : l.org_name}<div className="muted" style={{ fontSize: 12 }}>{l.contact_email}</div></td>
                        <td>{[l.city, l.state].filter(Boolean).join(", ") || "—"}</td>
                        <td><span className="pill">{l.size_bucket}</span></td>
                        <td>{l.estimated_attendance != null
                          ? (l.attendance_source_url ? <a href={l.attendance_source_url} target="_blank" rel="noreferrer">{l.estimated_attendance}</a> : l.estimated_attendance)
                          : <span className="muted">unknown</span>}</td>
                        <td>{l.discovery_confidence ?? "—"}</td>
                        <td><span className={statusPill(l.status)}>{l.status}</span></td>
                        <td>{l.send_count}{l.promo_code ? <div className="mono" style={{ fontSize: 11 }}>{l.promo_code}</div> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Send report */}
              {report && (
                <div className="card" style={{ marginTop: 14 }}>
                  <strong>Send {report.mode === "live" ? "result (LIVE)" : "preview (dry-run)"}</strong>
                  {report.gate_reasons.length > 0 && <p className="hint">Gate closed → stayed dry-run: {report.gate_reasons.join("; ")}</p>}
                  <p className="muted" style={{ fontSize: 13 }}>
                    scanned {report.scanned} · {report.mode === "live" ? `sent ${report.sent}` : `would send ${report.would_send}`} · not due {report.not_due} · complete {report.complete} · skipped {report.skipped} · errors {report.errors}
                  </p>
                  <div className="sim-scroll">
                    <table className="table"><thead><tr><th>Church</th><th>To</th><th>Touch</th><th>Outcome</th><th>Code</th></tr></thead>
                      <tbody>{report.items.filter((i) => i.outcome === "would_send" || i.outcome === "sent").map((i, n) => (
                        <tr key={n}><td>{i.org_name}</td><td>{i.to}</td><td>{i.touch}</td><td>{i.outcome}</td><td className="mono">{i.promo_code || "—"}</td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
