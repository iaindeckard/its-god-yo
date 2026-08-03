"use client";

import { useState } from "react";

type Counts = Record<string, number>;
interface LaunchSummary {
  dry_run: boolean;
  candidates: number;
  promoted: number;
  sms_sent: number;
  email_sent: number;
  skipped_unreachable: number;
  errors: Array<{ pending_signup_id: string; error: string }>;
}

const LABELS: Record<string, string> = {
  preorder_pending: "Reserved (not yet invited)",
  awaiting_confirmation: "Invited — awaiting YES",
  payment_failed: "Payment failed",
  active: "Active",
  removed: "Removed",
};

export default function PreorderLaunch({ initialCounts }: { initialCounts: Counts }) {
  const [counts, setCounts] = useState<Counts>(initialCounts);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<LaunchSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const pending = counts.preorder_pending ?? 0;

  async function refreshCounts() {
    const r = await fetch("/api/admin/preorder/launch");
    if (r.ok) setCounts((await r.json()).counts ?? {});
  }

  async function fire(dry: boolean) {
    setBusy(true);
    setErr(null);
    setSummary(null);
    try {
      const r = await fetch("/api/admin/preorder/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dry }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
      setSummary(d.summary);
      if (!dry) await refreshCounts();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <>
      <div className="admin-head">
        <h1>Preorder launch</h1>
      </div>

      <div className="grid cols-3" style={{ marginBottom: 20 }}>
        {Object.keys(LABELS).map((st) => (
          <div key={st} className="card">
            <div className="plan-name" style={{ fontSize: 28 }}>{counts[st] ?? 0}</div>
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>{LABELS[st]}</p>
          </div>
        ))}
      </div>

      <div className="card" style={{ maxWidth: 640 }}>
        <p style={{ marginTop: 0 }}>
          The launch trigger moves every <strong>reserved</strong> signup to <em>awaiting YES</em>,
          stamps the confirmation clock, and sends each recipient the &ldquo;reply YES to
          activate&rdquo; SMS plus an email to the purchaser. It is independent of
          PREORDER_MODE and only affects rows still in <code>preorder_pending</code>.
        </p>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn btn-ghost" disabled={busy} onClick={() => fire(true)}>
            {busy ? "Running…" : "Dry run (preview)"}
          </button>
          {!confirming ? (
            <button className="btn btn-primary" disabled={busy || pending === 0} onClick={() => setConfirming(true)}>
              Launch now ({pending})
            </button>
          ) : (
            <>
              <button className="btn btn-primary" disabled={busy} onClick={() => fire(false)} style={{ background: "#b4232a" }}>
                {busy ? "Sending…" : `Yes, invite all ${pending} — this sends real texts`}
              </button>
              <button className="btn btn-ghost" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
            </>
          )}
        </div>

        {err && <div className="error" style={{ marginTop: 14 }}>{err}</div>}

        {summary && (
          <div style={{ marginTop: 16, fontSize: 14 }}>
            <p style={{ fontWeight: 600, margin: "0 0 6px" }}>
              {summary.dry_run ? "Dry run — nothing sent or changed." : "Launch complete."}
            </p>
            <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
              <li>Candidates: {summary.candidates}</li>
              <li>{summary.dry_run ? "Would promote" : "Promoted"}: {summary.promoted}</li>
              <li>SMS {summary.dry_run ? "to send" : "sent"}: {summary.sms_sent}</li>
              <li>Emails {summary.dry_run ? "to send" : "sent"}: {summary.email_sent}</li>
              {summary.skipped_unreachable > 0 && <li>Left reserved (unreachable): {summary.skipped_unreachable}</li>}
              {summary.errors.length > 0 && <li style={{ color: "#b4232a" }}>Errors: {summary.errors.length}</li>}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}
