"use client";

import { Fragment, useState } from "react";
import type {
  ApplicationWithChurch, PartnerWithChurch, CornerstoneConfig,
} from "@/lib/cornerstone";

// Local number formatter — can't import the server-only lib helper into a client bundle.
const fmt = (n: number) => `CP-${String(n).padStart(6, "0")}`;

const appPill = (s: string) =>
  s === "approved" || s === "active" ? "pill pill-on"
  : s === "declined" || s === "cancelled" || s === "inactive" ? "pill pill-off"
  : "pill pill-warn";
const partnerPill = (s: string) => (s === "active" ? "pill pill-on" : s === "revoked" ? "pill pill-off" : "pill pill-warn");

type Tab = "applications" | "partners" | "config";

export default function CornerstoneManager({
  initialApplications, initialPartners, initialConfig, canReview, canManage,
}: {
  initialApplications: ApplicationWithChurch[];
  initialPartners: PartnerWithChurch[];
  initialConfig: CornerstoneConfig;
  canReview: boolean;
  canManage: boolean;
}) {
  const [tab, setTab] = useState<Tab>("applications");
  const [apps, setApps] = useState(initialApplications);
  const [partners, setPartners] = useState(initialPartners);
  const [config, setConfig] = useState(initialConfig);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState("");

  async function refreshApps() {
    const r = await fetch("/api/admin/cornerstone/applications");
    const d = await r.json();
    if (r.ok) setApps(d.applications);
  }
  async function refreshPartners() {
    const r = await fetch("/api/admin/cornerstone/partners");
    const d = await r.json();
    if (r.ok) setPartners(d.partners);
  }

  async function actOnApp(id: string, body: Record<string, unknown>) {
    setError(null); setNotice(null); setBusy(true);
    try {
      const r = await fetch(`/api/admin/cornerstone/applications/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      if (body.action === "approve") {
        setNotice(`Approved — assigned ${fmt(d.partner_number)} (Cornerstone Partner #${d.partner_number})${d.already_partner ? " (already a partner)" : ""}.`);
      }
      await Promise.all([refreshApps(), refreshPartners()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally { setBusy(false); }
  }

  async function patchPartner(id: string, body: Record<string, unknown>) {
    setError(null);
    const r = await fetch(`/api/admin/cornerstone/partners/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) { setError(d.error || "Failed"); return; }
    setPartners((cur) => cur.map((p) => (p.id === id ? { ...p, ...d.partner } : p)));
  }

  async function resendLink(id: string) {
    setError(null); setNotice(null);
    const r = await fetch(`/api/admin/cornerstone/partners/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "resend_link" }),
    });
    const d = await r.json();
    if (!r.ok) { setError(d.error || "Failed"); return; }
    setNotice(d.sent ? `Private status link re-sent to ${d.recipient}.` : `No contact email on file — couldn't send (recipient: ${d.recipient ?? "none"}).`);
  }

  const isTerminal = (s: string) => ["approved", "active", "declined", "cancelled"].includes(s);

  return (
    <>
      <div className="admin-head">
        <h1>Cornerstone Partners</h1>
      </div>
      <p className="muted" style={{ marginTop: -12, marginBottom: 16 }}>
        Recognizes churches that join during the founding stage. Approving an application assigns a
        <strong> permanent, never-reused partner number</strong> and creates the partner record. A church keeps its
        number and Cornerstone recognition even if its locked pricing later lapses — the two are tracked separately.
        {config.manual_approval_required && !config.auto_approval_enabled &&
          " Currently in manual-approval mode."}
      </p>

      <div className="cs-tabs" style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        {(["applications", "partners", "config"] as Tab[]).map((t) => (
          <button
            key={t}
            className={t === tab ? "btn btn-primary" : "btn btn-ghost"}
            style={{ padding: "6px 14px", fontSize: 13, textTransform: "capitalize" }}
            onClick={() => { setTab(t); setError(null); setNotice(null); }}
          >
            {t}{t === "applications" ? ` (${apps.length})` : t === "partners" ? ` (${partners.length})` : ""}
          </button>
        ))}
      </div>

      {error && <div className="error">{error}</div>}
      {notice && <div className="card" style={{ marginBottom: 16, borderColor: "var(--igy-teal, #00ABBC)" }}>{notice}</div>}

      {tab === "applications" && (
        <div className="sim-scroll">
          <table className="table">
            <thead>
              <tr><th>Church</th><th>Contact</th><th>Plan</th><th>Submitted</th><th>Status</th>{canReview && <th></th>}</tr>
            </thead>
            <tbody>
              {apps.length === 0 && <tr><td colSpan={canReview ? 6 : 5} className="muted">No applications yet.</td></tr>}
              {apps.map((a) => (
                <Fragment key={a.id}>
                  <tr>
                    <td>
                      <div style={{ fontWeight: 600 }}>{a.church?.name ?? "—"}</div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {[a.church?.city, a.church?.state_province, a.church?.country].filter(Boolean).join(", ") || "—"}
                      </div>
                    </td>
                    <td className="muted" style={{ fontSize: 13 }}>
                      {a.contact_name ?? "—"}{a.contact_email ? <><br />{a.contact_email}</> : null}
                      {a.existing_account_email ? <><br /><span style={{ fontSize: 11 }}>acct: {a.existing_account_email}</span></> : null}
                    </td>
                    <td className="muted">{a.preferred_plan ?? "—"}</td>
                    <td className="muted" style={{ whiteSpace: "nowrap", fontSize: 12 }}>{(a.submitted_at ?? a.created_at)?.slice(0, 10)}</td>
                    <td><span className={appPill(a.status)}>{a.status.replace("_", " ")}</span></td>
                    {canReview && (
                      <td style={{ whiteSpace: "nowrap" }}>
                        {!isTerminal(a.status) && (
                          <>
                            <button className="btn btn-primary" style={{ padding: "5px 10px", fontSize: 12, marginRight: 6 }} disabled={busy} onClick={() => actOnApp(a.id, { action: "approve" })}>Approve</button>
                            <button className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 12, marginRight: 6 }} disabled={busy} onClick={() => { setDecliningId(decliningId === a.id ? null : a.id); setDeclineReason(""); }}>Decline</button>
                            {a.status === "submitted" && <button className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 12 }} disabled={busy} onClick={() => actOnApp(a.id, { action: "set_status", status: "under_review" })}>Mark reviewing</button>}
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                  {decliningId === a.id && canReview && (
                    <tr>
                      <td colSpan={6}>
                        <div className="card" style={{ margin: "6px 0" }}>
                          <div className="field">
                            <label>Decline reason (internal — never shown to the church)</label>
                            <textarea rows={2} value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} placeholder="Why this application is being declined." />
                          </div>
                          <button className="btn btn-primary" disabled={busy} onClick={() => { actOnApp(a.id, { action: "decline", reason: declineReason }); setDecliningId(null); }}>Confirm decline</button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "partners" && (
        <div className="sim-scroll">
          <table className="table">
            <thead>
              <tr><th>#</th><th>Church</th><th>Recognized</th><th>Status</th><th>Public listing</th><th>Locked pricing</th>{canManage && <th></th>}</tr>
            </thead>
            <tbody>
              {partners.length === 0 && <tr><td colSpan={canManage ? 7 : 6} className="muted">No partners yet — approve an application to mint #1.</td></tr>}
              {partners.map((p) => (
                <tr key={p.id}>
                  <td className="mono" style={{ whiteSpace: "nowrap" }}>{fmt(p.partner_number)}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{p.church?.name ?? "—"}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{[p.church?.city, p.church?.state_province].filter(Boolean).join(", ") || "—"}</div>
                  </td>
                  <td className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{p.recognition_date}</td>
                  <td>
                    {canManage ? (
                      <select value={p.cornerstone_status} onChange={(e) => patchPartner(p.id, { cornerstone_status: e.target.value })}>
                        <option value="active">active</option>
                        <option value="inactive">inactive</option>
                        <option value="revoked">revoked</option>
                      </select>
                    ) : <span className={partnerPill(p.cornerstone_status)}>{p.cornerstone_status}</span>}
                  </td>
                  <td>
                    {canManage ? (
                      <select value={p.public_listing_status} onChange={(e) => patchPartner(p.id, { public_listing_status: e.target.value })}>
                        <option value="private">private</option>
                        <option value="listed">listed</option>
                      </select>
                    ) : p.public_listing_status}
                  </td>
                  <td>
                    {canManage ? (
                      <select value={p.locked_pricing_status} onChange={(e) => patchPartner(p.id, { locked_pricing_status: e.target.value })}>
                        <option value="none">none</option>
                        <option value="active">active</option>
                        <option value="suspended">suspended</option>
                        <option value="expired">expired</option>
                      </select>
                    ) : p.locked_pricing_status}
                  </td>
                  {canManage && (
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => resendLink(p.id)}>Resend link</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint" style={{ marginTop: 10 }}>
            Public listing also requires the church to have opted into public recognition. A partner number can never be
            edited here — it is permanent by design.
          </p>
        </div>
      )}

      {tab === "config" && (
        <ConfigForm config={config} canManage={canManage} onSaved={setConfig} setError={setError} setNotice={setNotice} />
      )}
    </>
  );
}

function ConfigForm({
  config, canManage, onSaved, setError, setNotice,
}: {
  config: CornerstoneConfig;
  canManage: boolean;
  onSaved: (c: CornerstoneConfig) => void;
  setError: (s: string | null) => void;
  setNotice: (s: string | null) => void;
}) {
  const [f, setF] = useState({
    program_active: config.program_active,
    manual_approval_required: config.manual_approval_required,
    auto_approval_enabled: config.auto_approval_enabled,
    public_recognition_default: config.public_recognition_default,
    enrollment_opens_at: config.enrollment_opens_at?.slice(0, 10) ?? "",
    enrollment_closes_at: config.enrollment_closes_at?.slice(0, 10) ?? "",
    eligible_plans: (config.eligible_plans ?? []).join(", "),
    terms_version: config.terms_version ?? "",
    certificate_scripture: config.certificate_scripture ?? "",
  });
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null); setNotice(null); setBusy(true);
    try {
      const payload = {
        program_active: f.program_active,
        manual_approval_required: f.manual_approval_required,
        auto_approval_enabled: f.auto_approval_enabled,
        public_recognition_default: f.public_recognition_default,
        enrollment_opens_at: f.enrollment_opens_at || null,
        enrollment_closes_at: f.enrollment_closes_at || null,
        eligible_plans: f.eligible_plans.split(",").map((s) => s.trim()).filter(Boolean),
        terms_version: f.terms_version,
        certificate_scripture: f.certificate_scripture || null,
      };
      const r = await fetch("/api/admin/cornerstone/config", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      onSaved(d.config);
      setNotice("Program config saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally { setBusy(false); }
  }

  const chk = (k: keyof typeof f, label: string, hint?: string) => (
    <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 12 }}>
      <input type="checkbox" checked={f[k] as boolean} disabled={!canManage} onChange={(e) => setF((s) => ({ ...s, [k]: e.target.checked }))} style={{ marginTop: 3 }} />
      <span><strong>{label}</strong>{hint && <div className="muted" style={{ fontSize: 12 }}>{hint}</div>}</span>
    </label>
  );

  return (
    <div className="card" style={{ maxWidth: 640 }}>
      {chk("program_active", "Program active", "Master switch for the Cornerstone Partner Program.")}
      {chk("manual_approval_required", "Manual approval required", "Launch default: staff review every application.")}
      {chk("auto_approval_enabled", "Automatic approval enabled", "Flip on later to auto-approve eligible enrollment-period applications — no redeploy needed.")}
      {chk("public_recognition_default", "Default new churches to public recognition", "When off, churches are private unless they opt in.")}
      <div className="row">
        <div className="field"><label>Enrollment opens</label><input type="date" value={f.enrollment_opens_at} disabled={!canManage} onChange={(e) => setF((s) => ({ ...s, enrollment_opens_at: e.target.value }))} /></div>
        <div className="field"><label>Enrollment closes</label><input type="date" value={f.enrollment_closes_at} disabled={!canManage} onChange={(e) => setF((s) => ({ ...s, enrollment_closes_at: e.target.value }))} /></div>
      </div>
      <div className="field"><label>Eligible plans (comma-separated plan keys)</label><input value={f.eligible_plans} disabled={!canManage} onChange={(e) => setF((s) => ({ ...s, eligible_plans: e.target.value }))} placeholder="group, group_301plus, family_annual" /></div>
      <div className="row">
        <div className="field"><label>Terms version</label><input value={f.terms_version} disabled={!canManage} onChange={(e) => setF((s) => ({ ...s, terms_version: e.target.value }))} placeholder="v1-draft" /></div>
        <div className="field"><label>Certificate scripture (optional)</label><input value={f.certificate_scripture} disabled={!canManage} onChange={(e) => setF((s) => ({ ...s, certificate_scripture: e.target.value }))} placeholder="e.g. Ephesians 2:20" /></div>
      </div>
      {canManage && <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save config"}</button>}
      {f.auto_approval_enabled && f.manual_approval_required && (
        <p className="hint" style={{ marginTop: 10 }}>Note: both manual and automatic approval are on — automatic will take precedence for eligible applications.</p>
      )}
    </div>
  );
}
