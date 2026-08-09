"use client";

import { useState } from "react";
import Link from "next/link";
import CampaignMap, { type CampaignMapChange, type MapLead } from "./CampaignMap";

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
  discount_percent: number; message_variant: string | null;
}

// Approved message variants (mirror of lib/outreach/templates.ts, which is
// server-only). Adding a new variant is a reviewed change in BOTH places + the
// approved copy in email.ts — a campaign can only pick from this fixed set.
const MESSAGE_VARIANTS: { key: string; label: string }[] = [
  { key: "default", label: "Default (approved)" },
];
interface Lead {
  id: string; org_name: string; city: string | null; state: string | null;
  contact_email: string; website: string | null; status: string;
  discovery_confidence: string | null; size_bucket: SizeBucket;
  estimated_attendance: number | null; attendance_source_url: string | null;
  send_count: number; last_sent_at: string | null; promo_code: string | null;
  latitude: number | null; longitude: number | null;
  verification_status: string; verified_at: string | null;
  verification_notes: Record<string, unknown> | null;
}
interface SendItem { org_name: string; to: string; outcome: string; touch: number | null; promo_code: string; subject: string; }
interface SendReport {
  mode: string; gate_reasons: string[]; scanned: number; sent: number;
  would_send: number; not_due: number; complete: number; skipped: number;
  skipped_unverified: number; errors: number;
  items: SendItem[];
}

const statusPill = (s: string) =>
  s === "active" ? "pill pill-on"
  : s === "converted" ? "pill pill-on"
  : s === "staged" ? "pill pill-warn"
  : s === "needs_review" ? "pill pill-warn"
  : "pill pill-off";

const verifyPill = (s: string) =>
  s === "passed" ? "pill pill-on"
  : s === "manual_override" ? "pill pill-on"
  : s === "needs_manual" ? "pill pill-warn"
  : s === "failed" ? "pill pill-off"
  : "pill"; // unverified

// Turn the machine verification_notes into one plain-language line so an override
// decision is informed without leaving the page. Returns null when there is
// nothing to explain (a passed/override lead, or missing notes).
function verificationReason(notes: Record<string, unknown> | null): string | null {
  if (!notes) return null;
  const bits: string[] = [];
  if (notes.mx_ok === false) {
    bits.push(notes.mx_reason === "no_mx_or_a_record"
      ? "email domain does not accept mail"
      : "email failed its format or domain check");
  }
  const pageOk = notes.org_match === true && notes.youth_match === true;
  if (!pageOk) {
    const r = typeof notes.page_reason === "string" ? notes.page_reason : "";
    if (r === "no_source_urls") bits.push("no source page was cited");
    else if (r.startsWith("non_html")) bits.push("cited source is a non-HTML file (e.g. a PDF)");
    else if (r === "timeout") bits.push("cited page timed out");
    else if (r.startsWith("http_")) bits.push(`cited page returned ${r.replace("http_", "HTTP ")}`);
    else if (r === "empty_after_strip") bits.push("cited page had no readable text (likely a JavaScript-only site)");
    else if (r === "invalid_url" || r === "non_http_url" || r === "fetch_error") bits.push("cited page could not be fetched");
    else if (r === "page_missing_org_or_youth") {
      if (notes.org_match !== true && notes.youth_match !== true) bits.push("page showed neither the church name nor a youth-ministry signal (may be a JavaScript-only site)");
      else if (notes.youth_match !== true) bits.push("no youth-ministry signal on the cited page");
      else bits.push("church name not found on the cited page");
    } else {
      bits.push("cited page could not be confirmed");
    }
  }
  return bits.length ? bits.join("; ") : null;
}

const toMapLeads = (ls: Lead[]): MapLead[] =>
  ls.map((l) => ({ id: l.id, org_name: l.org_name, status: l.status, latitude: l.latitude, longitude: l.longitude, size_bucket: l.size_bucket }));

export default function OutreachManager({
  initialCampaigns, canManage, canOverride,
}: { initialCampaigns: Campaign[]; canManage: boolean; canOverride: boolean }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>(initialCampaigns);
  const [selected, setSelected] = useState<Campaign | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [viewBucket, setViewBucket] = useState<"all" | SizeBucket>("all");
  const [promoteSel, setPromoteSel] = useState<Set<SizeBucket>>(new Set());
  const [report, setReport] = useState<SendReport | null>(null);
  const [createName, setCreateName] = useState("");
  const [createDraft, setCreateDraft] = useState<CampaignMapChange | null>(null);
  const [detailDraft, setDetailDraft] = useState<CampaignMapChange | null>(null);
  const [offerDraft, setOfferDraft] = useState<{ discount_percent: string; message_variant: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refreshCampaigns() {
    const res = await fetch("/api/admin/outreach/campaigns");
    const data = await res.json();
    if (res.ok) setCampaigns(data.campaigns);
  }

  async function openCampaign(c: Campaign) {
    setSelected(c); setLeads([]); setReport(null); setViewBucket("all"); setPromoteSel(new Set()); setDetailDraft(null); setOfferDraft(null);
    const res = await fetch(`/api/admin/outreach/campaigns/${c.id}`);
    const data = await res.json();
    if (res.ok) {
      setSelected(data.campaign); setLeads(data.leads);
      setOfferDraft({ discount_percent: String(data.campaign.discount_percent ?? 10), message_variant: data.campaign.message_variant ?? "default" });
    } else setError(data.error || "failed to load campaign");
  }

  // Deselect => Step 1 create mode (draw a new area). One control drives the
  // mode switch; the single map remounts via key={selected?.id ?? "new"}.
  function newCampaign() {
    setSelected(null); setLeads([]); setReport(null);
    setViewBucket("all"); setPromoteSel(new Set());
    setDetailDraft(null); setOfferDraft(null); setError(null);
    setCreateName(""); setCreateDraft(null);
  }

  async function createCampaign() {
    setError(null);
    if (!createName.trim()) { setError("Name is required."); return; }
    if (!createDraft) { setError("Pick a center on the map (click, drag, or search)."); return; }
    setBusy("create");
    try {
      const res = await fetch("/api/admin/outreach/campaigns", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: createName,
          center_label: createDraft.center_label || createName,
          center_lat: createDraft.center_lat, center_lng: createDraft.center_lng,
          radius_miles: createDraft.radius_miles,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "create failed");
      setCreateName(""); setCreateDraft(null);
      await refreshCampaigns();
      await openCampaign(data.campaign);
    } catch (e) { setError(e instanceof Error ? e.message : "create failed"); }
    finally { setBusy(null); }
  }

  async function saveCenter() {
    if (!selected || !detailDraft) return;
    setError(null); setBusy("save-center");
    try {
      const res = await fetch(`/api/admin/outreach/campaigns/${selected.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          center_lat: detailDraft.center_lat, center_lng: detailDraft.center_lng,
          radius_miles: detailDraft.radius_miles, center_label: detailDraft.center_label,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "save failed");
      setDetailDraft(null);
      await refreshCampaigns();
      await openCampaign(data.campaign);
    } catch (e) { setError(e instanceof Error ? e.message : "save failed"); }
    finally { setBusy(null); }
  }

  async function saveOffer() {
    if (!selected || !offerDraft) return;
    setError(null); setBusy("save-offer");
    try {
      const res = await fetch(`/api/admin/outreach/campaigns/${selected.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ discount_percent: Number(offerDraft.discount_percent), message_variant: offerDraft.message_variant }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "save failed");
      await openCampaign(selected);
    } catch (e) { setError(e instanceof Error ? e.message : "save failed"); }
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

  async function verifyLeadsRun() {
    if (!selected) return;
    setError(null); setBusy("verify");
    try {
      const res = await fetch(`/api/admin/outreach/campaigns/${selected.id}/verify`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "verify failed");
      await openCampaign(selected);
    } catch (e) { setError(e instanceof Error ? e.message : "verify failed"); }
    finally { setBusy(null); }
  }

  async function overrideVerification(leadId: string) {
    setError(null); setBusy(`override:${leadId}`);
    try {
      const res = await fetch(`/api/admin/outreach/leads/${leadId}/verify-override`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "override failed");
      if (selected) await openCampaign(selected);
    } catch (e) { setError(e instanceof Error ? e.message : "override failed"); }
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
      // Refresh the campaign/leads FIRST, then set the report LAST: openCampaign
      // clears report (setReport(null)) at its start, so setting the report before
      // it would be instantly clobbered (the "flash then vanish" bug). The report
      // is a persistent card that must stay until the next action.
      await openCampaign(selected);
      setReport(data.report);
    } catch (e) { setError(e instanceof Error ? e.message : "send failed"); }
    finally { setBusy(null); }
  }

  const shown = viewBucket === "all" ? leads : leads.filter((l) => l.size_bucket === viewBucket);
  const stagedByBucket = (b: SizeBucket) => leads.filter((l) => l.size_bucket === b && l.status === "staged").length;

  return (
    <div>
      <div className="admin-head">
        <h1>Outreach campaigns</h1>
        <p className="muted">
          A guided flow: define an area, discover churches, review and verify, set the offer and promote, then preview and send.{" "}
          <Link href="/admin/outreach/performance">View performance →</Link>
        </p>
      </div>

      {error && <div className="card" style={{ borderColor: "#c0392b", color: "#c0392b" }}>{error}</div>}

      {/* Campaign picker + New campaign (deselect => Step 1 create mode) */}
      <div className="card" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13, marginRight: 4 }}>Campaign:</strong>
        {campaigns.length === 0 && <span className="muted">none yet</span>}
        {campaigns.map((c) => (
          <button key={c.id} className="btn btn-ghost" style={{ fontWeight: selected?.id === c.id ? 700 : 400 }} onClick={() => openCampaign(c)}>
            {c.name} <span className={statusPill(c.status)} style={{ marginLeft: 4 }}>{c.status}</span>
          </button>
        ))}
        {canManage && (
          <button className="btn btn-primary" style={{ marginLeft: "auto" }} onClick={newCampaign} disabled={!selected && !createName && !createDraft}>
            + New campaign
          </button>
        )}
      </div>

      {/* STEP 1 — Define area (single mode-switched map) */}
      <div className="card">
        <h3>1 · Define area</h3>
        {!selected
          ? <p className="muted">Draw a search area for a new campaign: name it, then click the map, drag the pin, or search a place to set the center, and use the slider for the radius.</p>
          : <p className="muted">{selected.center_label} · {Number(selected.radius_miles)}mi · {leads.length} leads · <span className={statusPill(selected.status)}>{selected.status}</span></p>}

        {!selected && canManage && (
          <div className="field" style={{ maxWidth: 360 }}>
            <label>Name</label>
            <input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="Dallas Metro 50mi" />
          </div>
        )}

        <div style={{ marginTop: 10 }}>
          <CampaignMap
            key={selected?.id ?? "new"}
            editable={canManage}
            initialCenter={selected && selected.center_lat != null && selected.center_lng != null ? { lat: selected.center_lat, lng: selected.center_lng } : null}
            initialRadiusMiles={selected ? Number(selected.radius_miles) : 50}
            leads={selected ? toMapLeads(leads) : undefined}
            onChange={selected ? (canManage ? setDetailDraft : undefined) : (canManage ? setCreateDraft : undefined)}
          />
        </div>

        {!selected && canManage && (
          <div style={{ marginTop: 10 }}>
            <button className="btn btn-primary" disabled={busy === "create"} onClick={createCampaign}>
              {busy === "create" ? "Creating…" : "Create campaign"}</button>
            <span className="hint" style={{ marginLeft: 10 }}>Click the map, drag the pin, or search a place to set the center; the slider sets the radius.</span>
          </div>
        )}
        {selected && canManage && detailDraft && (
          <button className="btn btn-primary" style={{ marginTop: 8 }} disabled={busy === "save-center"} onClick={saveCenter}>
            {busy === "save-center" ? "Saving…" : "Save center / radius"}</button>
        )}
      </div>

      {/* Steps 2–5 apply to a selected campaign. Order is guidance only, not a
          hard lock — every action stays available whenever it is valid. */}
      {selected && (
        <>
          {/* STEP 2 — Discover */}
          <div className="card">
            <h3>2 · Discover</h3>
            <p className="muted">Search public sources for churches within the radius, using only public general emails and youth-ministry signals. Discovered leads land staged (found, not yet in the send pipeline) and are auto-verified.</p>
            {canManage && (
              <button className="btn btn-primary" disabled={busy === "discover"} onClick={runDiscovery}>
                {busy === "discover" ? "Discovering…" : "Run discovery"}</button>
            )}
          </div>

          {/* STEP 3 — Review leads (verification reasons inline) */}
          <div className="card">
            <h3>3 · Review leads</h3>
            <div className="row" style={{ margin: "6px 0", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
              <div className="field" style={{ margin: 0 }}><label>Filter by size</label>
                <select value={viewBucket} onChange={(e) => setViewBucket(e.target.value as "all" | SizeBucket)}>
                  <option value="all">All sizes</option>
                  {BUCKETS.map((b) => <option key={b} value={b}>{BUCKET_LABEL[b]}</option>)}
                </select>
              </div>
              {canManage && (
                <button className="btn btn-ghost" disabled={busy === "verify"} onClick={verifyLeadsRun}>
                  {busy === "verify" ? "Verifying…" : "Re-verify leads"}</button>
              )}
            </div>
            <div className="sim-scroll">
              <table className="table">
                <thead><tr>
                  <th>Church</th><th>Location</th><th>Size</th><th>Attendance</th><th>Confidence</th><th>Status</th><th>Verified</th><th>Sends</th>
                </tr></thead>
                <tbody>
                  {shown.length === 0 && <tr><td colSpan={8} className="muted">No leads{viewBucket !== "all" ? " in this size bucket" : ""}.</td></tr>}
                  {shown.map((l) => {
                    const reason = (l.verification_status !== "passed" && l.verification_status !== "manual_override")
                      ? verificationReason(l.verification_notes) : null;
                    return (
                      <tr key={l.id}>
                        <td>{l.website ? <a href={l.website} target="_blank" rel="noreferrer">{l.org_name}</a> : l.org_name}<div className="muted" style={{ fontSize: 12 }}>{l.contact_email}</div></td>
                        <td>{[l.city, l.state].filter(Boolean).join(", ") || "—"}</td>
                        <td><span className="pill">{l.size_bucket}</span></td>
                        <td>{l.estimated_attendance != null
                          ? (l.attendance_source_url ? <a href={l.attendance_source_url} target="_blank" rel="noreferrer">{l.estimated_attendance}</a> : l.estimated_attendance)
                          : <span className="muted">unknown</span>}</td>
                        <td>{l.discovery_confidence ?? "—"}</td>
                        <td><span className={statusPill(l.status)}>{l.status}</span></td>
                        <td>
                          <span className={verifyPill(l.verification_status)}>{l.verification_status}</span>
                          {canOverride && l.verification_status !== "passed" && l.verification_status !== "manual_override" && (
                            <button className="btn btn-ghost" style={{ marginLeft: 6, padding: "2px 6px", fontSize: 11 }}
                              disabled={busy === `override:${l.id}`} onClick={() => overrideVerification(l.id)}
                              title="Mark this lead manually verified so it can send (requires the override permission)">
                              {busy === `override:${l.id}` ? "…" : "Override"}</button>
                          )}
                          {reason && <div className="muted" style={{ fontSize: 11, marginTop: 2, maxWidth: 320 }}>{reason}</div>}
                        </td>
                        <td>{l.send_count}{l.promo_code ? <div className="mono" style={{ fontSize: 11 }}>{l.promo_code}</div> : null}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* STEP 4 — Set offer + promote (merged) */}
          {canManage && (
            <div className="card">
              <h3>4 · Set offer + promote</h3>
              {offerDraft && (
                <div style={{ margin: "6px 0", padding: "10px 12px", background: "#fff8ec", borderRadius: 8 }}>
                  <strong style={{ fontSize: 13 }}>Offer</strong>
                  <div className="row" style={{ gap: 12, margin: "8px 0", alignItems: "flex-end", flexWrap: "wrap" }}>
                    <div className="field" style={{ margin: 0 }}>
                      <label>Discount %</label>
                      <input type="number" min={1} max={100} style={{ width: 90 }} value={offerDraft.discount_percent}
                        onChange={(e) => setOfferDraft((o) => o && { ...o, discount_percent: e.target.value })} />
                    </div>
                    <div className="field" style={{ margin: 0 }}>
                      <label>Message variant</label>
                      <select value={offerDraft.message_variant}
                        onChange={(e) => setOfferDraft((o) => o && { ...o, message_variant: e.target.value })}>
                        {MESSAGE_VARIANTS.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
                      </select>
                    </div>
                    <button className="btn btn-primary" disabled={busy === "save-offer"} onClick={saveOffer}>
                      {busy === "save-offer" ? "Saving…" : "Save offer"}</button>
                  </div>
                  <p className="hint" style={{ margin: 0 }}>The discount templates only the numeral into the approved copy (&ldquo;{offerDraft.discount_percent || "N"}% off&rdquo;). New copy variants require copy + legal approval.</p>
                </div>
              )}
              <div style={{ margin: "6px 0", padding: "10px 12px", background: "#f6faff", borderRadius: 8 }}>
                <strong style={{ fontSize: 13 }}>Promote staged leads → active (enters send pipeline)</strong>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "8px 0" }}>
                  {BUCKETS.map((b) => {
                    const n = stagedByBucket(b);
                    return (
                      <label key={b} style={{ fontSize: 13, opacity: n ? 1 : 0.4 }}>
                        <input type="checkbox" disabled={!n} checked={promoteSel.has(b)}
                          onChange={(e) => setPromoteSel((s) => { const n2 = new Set(s); if (e.target.checked) n2.add(b); else n2.delete(b); return n2; })} />
                        {" "}{BUCKET_LABEL[b]} ({n} staged)
                      </label>
                    );
                  })}
                </div>
                <button className="btn btn-primary" disabled={promoteSel.size === 0 || busy === "promote"} onClick={promote}>
                  {busy === "promote" ? "Promoting…" : "Promote selected"}</button>
              </div>
            </div>
          )}

          {/* STEP 5 — Preview + send */}
          {canManage && (
            <div className="card">
              <h3>5 · Preview + send</h3>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <button className="btn btn-ghost" disabled={!!busy} onClick={() => send(false)}>
                  {busy === "send-dry" ? "Previewing…" : "Preview send (dry-run)"}</button>
                <button className="btn btn-ghost" disabled={!!busy} onClick={() => send(true)} style={{ borderColor: "#c0392b", color: "#c0392b" }}>
                  {busy === "send-live" ? "Sending…" : "Send live"}</button>
              </div>
              <p className="hint" style={{ marginTop: 8 }}>
                The Send live button alone does not put mail in inboxes. A real send also requires the three server env flags (OUTREACH_COPY_APPROVED, OUTREACH_LEGAL_APPROVED, OUTREACH_SEND_LIVE) to be set and the app redeployed; those are not editable from this page. Until then every run stays a dry-run preview, and only verified, promoted leads are ever eligible.
              </p>

              {report && (
                <div className="card" style={{ marginTop: 14 }}>
                  <strong>Send {report.mode === "live" ? "result (LIVE)" : "preview (dry-run)"}</strong>
                  {report.gate_reasons.length > 0 && <p className="hint">Gate closed → stayed dry-run: {report.gate_reasons.join("; ")}</p>}
                  <p className="muted" style={{ fontSize: 13 }}>
                    scanned {report.scanned} · {report.mode === "live" ? `sent ${report.sent}` : `would send ${report.would_send}`} · not due {report.not_due} · complete {report.complete} · unverified {report.skipped_unverified} · skipped {report.skipped} · errors {report.errors}
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
            </div>
          )}
        </>
      )}
    </div>
  );
}
