"use client";

import { useState } from "react";
import type { ReviewGroup, BountyLedger } from "@/lib/bounty";

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const when = (iso: string) => new Date(iso).toLocaleString();

export default function BountyManager({
  initialGroups,
  initialLedger,
  canReview,
}: {
  initialGroups: ReviewGroup[];
  initialLedger: BountyLedger;
  canReview: boolean;
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
        setNote(
          r.credited
            ? `Confirmed. ${usd(r.credit_cents)} credit applied to ${r.winner_email} (first of ${r.report_count}) — it auto-reduces their next invoice.${r.warning ? ` ⚠ ${r.warning}` : ""}`
            : r.capped
              ? `Confirmed. ${r.winner_email} was first, but they've hit this year's credit cap — no new credit. They were notified warmly.`
              : r.skipped
                ? `Confirmed, but couldn't auto-credit ${r.winner_email}: ${r.skipped_reason}. They were emailed that we'll follow up; logged as "needs follow-up".`
                : `Confirmed (${r.report_count} report(s)).`,
        );
      } else {
        setNote(`Marked not an error (${r.report_count} report(s) closed). Reporters were notified.`);
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally { setBusy(false); }
  }

  return (
    <>
      <div className="admin-head">
        <h1>Error bounty</h1>
        <span className="dev-badge">1/12-annual credit · human-confirmed · auto-applied via Stripe</span>
      </div>
      <p className="muted" style={{ marginTop: -12, marginBottom: 20 }}>
        Subscribers report translation/wording issues. Reports on the same verse/date/track are grouped; you confirm or
        reject each group. A confirmed error rewards the <strong>earliest reporter</strong> with a credit worth{" "}
        <strong>one month of their own plan</strong> (1/12 of their annual price), applied as a Stripe account-balance
        credit that automatically reduces their next invoice. Capped at 6 months&rsquo; worth of credit per account per
        calendar year. Nothing to redeem by hand.
      </p>

      {error && <div className="error">{error}</div>}
      {note && <div className="admin-note">{note}</div>}

      {/* Ledger summary */}
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 24 }}>
        <div className="kpi">
          <div className="k-label">Credit issued</div>
          <div className="k-value">{usd(ledger.issuedCents)}</div>
          <div className="k-sub">{ledger.issuedCount} credit(s), auto-applied</div>
        </div>
        <div className="kpi">
          <div className="k-label">Rewarded reporters (YTD)</div>
          <div className="k-value">{ledger.reporterYtd.length}</div>
          <div className="k-sub">this calendar year</div>
        </div>
        <div className="kpi">
          <div className="k-label">Needs follow-up</div>
          <div className="k-value">{ledger.skippedCount + ledger.reconcileCount}</div>
          <div className="k-sub">{ledger.skippedCount} skipped · {ledger.reconcileCount} to reconcile</div>
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
          <p className="hint" style={{ marginTop: 8 }}>Confirming rewards only the <strong>1st</strong> reporter, subject to their annual cap.</p>
        </div>
      ))}

      {/* Needs follow-up — actionable list (skipped + reconcile) */}
      {ledger.followUps.length > 0 && (
        <>
          <h2 style={{ margin: "20px 0 4px" }}>⚠ Needs follow-up</h2>
          <p className="muted" style={{ marginTop: 0, marginBottom: 10 }}>
            <strong>Skipped</strong> = confirmed but we couldn&rsquo;t credit them (no active subscription) — reach out and
            apply a credit manually. <strong>Reconcile</strong> = the Stripe credit went through but our ledger write was
            degraded — verify the transaction below in Stripe; the money already moved.
          </p>
          <div className="sim-scroll">
            <table className="table" style={{ marginBottom: 16 }}>
              <thead><tr><th>Type</th><th>Reporter</th><th>Owed</th><th>Why</th><th>Stripe refs</th></tr></thead>
              <tbody>
                {ledger.followUps.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {c.status === "skipped"
                        ? <span className="pill pill-warn">skipped</span>
                        : <span className="pill pill-warn">reconcile</span>}
                    </td>
                    <td className="mono">{c.reporter_email}</td>
                    <td style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{c.amount_cents > 0 ? usd(c.amount_cents) : "1 month (compute)"}</td>
                    <td style={{ maxWidth: 320, fontSize: 12 }} className="muted">{c.skipped_reason ?? "—"}</td>
                    <td className="mono" style={{ fontSize: 11 }}>
                      {c.stripe_balance_transaction_id && <div>txn: {c.stripe_balance_transaction_id}</div>}
                      {c.reporter_stripe_customer_id && <div>cust: {c.reporter_stripe_customer_id}</div>}
                      <div className="muted">report: {c.report_id}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Reporter YTD (cap visibility) */}
      {ledger.reporterYtd.length > 0 && (
        <>
          <h2 style={{ margin: "20px 0 10px" }}>Rewarded this year (cap tracking)</h2>
          <div className="sim-scroll">
            <table className="table" style={{ marginBottom: 16 }}>
              <thead><tr><th>Reporter</th><th>Credits</th><th>Credited YTD</th></tr></thead>
              <tbody>
                {ledger.reporterYtd.map((b) => (
                  <tr key={b.reporter_email}>
                    <td className="mono">{b.reporter_email}</td>
                    <td>{b.credited_count}</td>
                    <td style={{ fontWeight: 700 }}>{usd(b.ytd_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Credit ledger */}
      <h2 style={{ margin: "20px 0 10px" }}>Credit ledger</h2>
      <div className="sim-scroll">
        <table className="table">
          <thead><tr><th>Reporter</th><th>Amount</th><th>Issued</th><th>Status</th></tr></thead>
          <tbody>
            {ledger.recentCredits.length === 0 && (
              <tr><td colSpan={4} className="muted">No credits issued yet.</td></tr>
            )}
            {ledger.recentCredits.map((c) => (
              <tr key={c.id}>
                <td className="mono">{c.reporter_email}</td>
                <td>{c.amount_cents > 0 ? usd(c.amount_cents) : "—"}</td>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{when(c.issued_at)}</td>
                <td>
                  {c.status === "issued" && <span className="pill pill-on">issued</span>}
                  {c.status === "skipped" && <span className="pill pill-warn" title={c.skipped_reason ?? undefined}>needs follow-up</span>}
                  {c.status === "reconcile" && <span className="pill pill-warn" title={c.skipped_reason ?? undefined}>reconcile — verify in Stripe</span>}
                  {c.status === "reversed" && <span className="pill pill-off">reversed</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ marginTop: 10 }}>
        Credits are applied automatically as a Stripe customer-balance credit the moment you confirm an error — they
        reduce whatever invoice the customer gets next. A <strong>needs follow-up</strong> row means the winner had no
        matchable account or active subscription at confirm time; resolve those by hand.
      </p>
    </>
  );
}
