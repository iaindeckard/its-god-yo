"use client";

import { useState } from "react";
import type { ReviewGroup, BountyLedger } from "@/lib/bounty";

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const when = (iso: string) => new Date(iso).toLocaleString();

export default function BountyManager({
  initialGroups,
  initialLedger,
  canReview,
  canApply,
}: {
  initialGroups: ReviewGroup[];
  initialLedger: BountyLedger;
  canReview: boolean;
  canApply: boolean;
}) {
  const [groups, setGroups] = useState<ReviewGroup[]>(initialGroups);
  const [ledger, setLedger] = useState<BountyLedger>(initialLedger);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const res = await fetch("/api/admin/bounty");
    const data = await res.json();
    if (res.ok) { setGroups(data.groups); setLedger(data.ledger); }
  }

  async function review(groupKey: string, decision: "confirm" | "reject") {
    setError(null); setNote(null); setBusy(true);
    try {
      const res = await fetch("/api/admin/bounty/review", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_key: groupKey, decision }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "review failed");
      const r = data.result;
      if (decision === "confirm") {
        setNote(r.credited
          ? `Confirmed. Credit earned by ${r.winner_email} (first reporter of ${r.report_count}).`
          : r.capped
            ? `Confirmed, but ${r.winner_email} already hit the 1-credit monthly cap — no new credit issued.`
            : `Confirmed (${r.report_count} report(s)).`);
      } else {
        setNote(`Marked not an error (${r.report_count} report(s) closed).`);
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally { setBusy(false); }
  }

  async function apply(creditId: string) {
    setError(null); setBusy(true);
    try {
      const res = await fetch("/api/admin/bounty/apply", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credit_id: creditId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "apply failed");
      setLedger(data.ledger);
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally { setBusy(false); }
  }

  return (
    <>
      <div className="admin-head">
        <h1>Error bounty</h1>
        <span className="dev-badge">$6.99 internal credit · human-confirmed · manually redeemed</span>
      </div>
      <p className="muted" style={{ marginTop: -12, marginBottom: 20 }}>
        Subscribers report translation/wording issues. Reports on the same verse/date/track are grouped; you confirm or
        reject each group. A confirmed error earns the <strong>earliest reporter</strong> a $6.99 internal credit (max 1
        per person per month). Credits sit as an unredeemed balance until an admin manually applies them — nothing
        touches Stripe automatically.
      </p>

      {error && <div className="error">{error}</div>}
      {note && <div className="admin-note">{note}</div>}

      {/* Ledger summary */}
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 24 }}>
        <div className="kpi">
          <div className="k-label">Unredeemed credit</div>
          <div className="k-value">{usd(ledger.availableCents)}</div>
          <div className="k-sub">earned, not yet applied</div>
        </div>
        <div className="kpi">
          <div className="k-label">Total earned</div>
          <div className="k-value">{usd(ledger.totalEarnedCents)}</div>
          <div className="k-sub">all confirmed rewards</div>
        </div>
        <div className="kpi">
          <div className="k-label">Applied</div>
          <div className="k-value">{usd(ledger.appliedCents)}</div>
          <div className="k-sub">manually redeemed</div>
        </div>
      </div>

      {/* Review queue */}
      <h2 style={{ margin: "8px 0 12px" }}>Reports awaiting review</h2>
      {groups.length === 0 && <p className="muted" style={{ marginBottom: 24 }}>No reports awaiting review.</p>}
      {groups.map((g) => (
        <div key={g.group_key} className="card" style={{ marginBottom: 16 }}>
          <div className="admin-head" style={{ marginBottom: 8 }}>
            <div>
              <span className="mono" style={{ fontWeight: 700 }}>{g.verse_ref}</span>{" "}
              <span className="muted">· {g.report_date} · {g.theme_track} · {g.report_count} report(s)</span>
            </div>
            {canReview && (
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-primary" style={{ padding: "7px 14px", fontSize: 13 }} disabled={busy} onClick={() => review(g.group_key, "confirm")}>Confirm error</button>
                <button className="btn btn-ghost" style={{ padding: "7px 14px", fontSize: 13 }} disabled={busy} onClick={() => review(g.group_key, "reject")}>Not an error</button>
              </div>
            )}
          </div>
          <div className="sim-scroll">
            <table className="table">
              <thead><tr><th></th><th>Reporter</th><th>Submitted</th><th>What they said</th></tr></thead>
              <tbody>
                {g.reports.map((r) => (
                  <tr key={r.id}>
                    <td>{r.reporter_email === g.earliest_reporter_email ? <span className="pill pill-on">1st</span> : ""}</td>
                    <td className="mono">{r.reporter_email}</td>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>{when(r.submitted_at)}</td>
                    <td style={{ maxWidth: 320 }}>
                      {r.reported_text && <div className="muted" style={{ fontSize: 12 }}>&ldquo;{r.reported_text}&rdquo;</div>}
                      {r.description}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint" style={{ marginTop: 8 }}>Confirming rewards only the <strong>1st</strong> reporter, subject to their monthly cap.</p>
        </div>
      ))}

      {/* Credit ledger */}
      <h2 style={{ margin: "20px 0 10px" }}>Credit ledger</h2>
      {ledger.reporterBalances.length > 0 && (
        <div className="sim-scroll">
          <table className="table" style={{ marginBottom: 16 }}>
            <thead><tr><th>Reporter</th><th>Credits earned</th><th>Unredeemed balance</th></tr></thead>
            <tbody>
              {ledger.reporterBalances.map((b) => (
                <tr key={b.reporter_email}>
                  <td className="mono">{b.reporter_email}</td>
                  <td>{b.earned_count}</td>
                  <td style={{ fontWeight: 700 }}>{usd(b.available_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="sim-scroll">
        <table className="table">
          <thead><tr><th>Reporter</th><th>Amount</th><th>Issued</th><th>Status</th>{canApply && <th></th>}</tr></thead>
          <tbody>
            {ledger.recentCredits.length === 0 && (
              <tr><td colSpan={canApply ? 5 : 4} className="muted">No credits earned yet.</td></tr>
            )}
            {ledger.recentCredits.map((c) => (
              <tr key={c.id}>
                <td className="mono">{c.reporter_email}</td>
                <td>{usd(c.amount_cents)}</td>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{when(c.issued_at)}</td>
                <td>
                  {c.status === "earned" && <span className="pill pill-on">earned</span>}
                  {c.status === "applied" && <span className="pill pill-off">applied{c.applied_at ? ` ${new Date(c.applied_at).toLocaleDateString()}` : ""}</span>}
                  {c.status === "expired" && <span className="pill pill-warn">expired</span>}
                </td>
                {canApply && (
                  <td>
                    {c.status === "earned" && (
                      <button className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 13 }} disabled={busy} onClick={() => apply(c.id)}>Apply credit</button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ marginTop: 10 }}>
        &ldquo;Apply credit&rdquo; is the deliberate manual redemption step — it marks the credit applied in this ledger.
        It does not call Stripe; how the credit actually reduces a bill is handled off this ledger, on purpose.
      </p>
    </>
  );
}
