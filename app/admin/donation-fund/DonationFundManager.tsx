"use client";

import { useState } from "react";
import type { FundSummary, DailyClose } from "@/lib/donationFund";

const usd = (cents: number) =>
  `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function DonationFundManager({
  initialSummary,
  canDisburse,
}: {
  initialSummary: FundSummary;
  canDisburse: boolean;
}) {
  const [summary, setSummary] = useState<FundSummary>(initialSummary);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // disbursement form
  const [charity, setCharity] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [disbNotes, setDisbNotes] = useState("");

  // manual close
  const [closeDate, setCloseDate] = useState("");
  const [lastClose, setLastClose] = useState<DailyClose | null>(null);

  async function disburse() {
    setError(null); setBusy(true);
    try {
      const res = await fetch("/api/admin/donation-fund/disburse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ charityName: charity, amount, reference: reference || undefined, notes: disbNotes || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to record");
      setSummary(data.summary);
      setCharity(""); setAmount(""); setReference(""); setDisbNotes("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally { setBusy(false); }
  }

  async function runClose() {
    setError(null); setBusy(true); setLastClose(null);
    try {
      const res = await fetch("/api/admin/donation-fund/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: closeDate || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to close");
      setLastClose(data.close);
      // refresh summary
      const s = await fetch("/api/admin/donation-fund").then((r) => r.json());
      if (s.summary) setSummary(s.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally { setBusy(false); }
  }

  return (
    <>
      <div className="admin-head">
        <h1>Donation Fund</h1>
        <span className="dev-badge">10% of daily net profit · ledger only</span>
      </div>
      <p className="muted" style={{ marginTop: -12, marginBottom: 20 }}>
        A close-of-business job each day computes net profit from exact inputs (Stripe fees, a precise daily share of
        flat recurring costs, real Twilio usage, one-time costs) and reserves 10% of a positive net. Loss days reserve
        $0 and never reduce the balance. Nothing is physically moved — this is a ledger the operating account is measured
        against.
      </p>

      {error && <div className="error">{error}</div>}

      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 22 }}>
        <div className="kpi">
          <div className="k-label">Available to disburse</div>
          <div className="k-value">{usd(summary.availableCents)}</div>
          <div className="k-sub">accrued − donated</div>
        </div>
        <div className="kpi">
          <div className="k-label">Total accrued</div>
          <div className="k-value">{usd(summary.accruedCents)}</div>
          <div className="k-sub">tithe reserved to date</div>
        </div>
        <div className="kpi">
          <div className="k-label">Total donated</div>
          <div className="k-value">{usd(summary.disbursedCents)}</div>
          <div className="k-sub">disbursed out</div>
        </div>
      </div>

      {/* Cost basis */}
      <h2 style={{ margin: "8px 0 10px" }}>Recurring cost basis (daily share)</h2>
      <div className="sim-scroll">
        <table className="table" style={{ marginBottom: 8 }}>
          <thead>
            <tr><th>Vendor</th><th>Description</th><th>Amount</th><th>Cadence</th><th>Daily share</th><th>Source</th></tr>
          </thead>
          <tbody>
            {summary.recurringCosts.length === 0 && (
              <tr><td colSpan={6} className="muted">No recurring costs configured.</td></tr>
            )}
            {summary.recurringCosts.map((c) => (
              <tr key={c.vendor + c.description}>
                <td style={{ fontWeight: 600 }}>{c.vendor}</td>
                <td className="muted">{c.description ?? "—"}</td>
                <td>{usd(c.amount_cents)}</td>
                <td>{c.cadence}</td>
                <td>{usd(c.dailyShareCents)}</td>
                <td>
                  {c.source === "needs_confirmation"
                    ? <span className="pill pill-warn">needs confirmation</span>
                    : <span className="pill pill-on">{c.source}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ marginBottom: 22 }}>
        Vercel (Hobby) and GitHub (Free) are $0. The GoDaddy domain amount is a standard-rate placeholder pending Iain&rsquo;s
        actual receipt — update it in <span className="mono">igy_recurring_costs</span> and the daily share recomputes.
      </p>

      {canDisburse && (
        <div className="card" style={{ marginBottom: 22 }}>
          <h2 style={{ marginTop: 0 }}>Record a donation</h2>
          <div className="row">
            <div className="field">
              <label>Charity name</label>
              <input value={charity} onChange={(e) => setCharity(e.target.value)} placeholder="e.g. Feeding America" />
            </div>
            <div className="field">
              <label>Amount (USD) — max {usd(summary.availableCents)}</label>
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} min={0.01} step={0.01} placeholder="0.00" />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>Reference (optional)</label>
              <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="check #, transfer id" />
            </div>
            <div className="field">
              <label>Notes (optional)</label>
              <input value={disbNotes} onChange={(e) => setDisbNotes(e.target.value)} />
            </div>
          </div>
          <button className="btn btn-primary" onClick={disburse} disabled={busy || summary.availableCents <= 0}>
            {busy ? "Recording…" : "Record disbursement"}
          </button>
          {summary.availableCents <= 0 && <p className="hint">Nothing reserved to disburse yet.</p>}
        </div>
      )}

      {canDisburse && (
        <div className="card" style={{ marginBottom: 22 }}>
          <h2 style={{ marginTop: 0 }}>Run daily close</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Recompute a specific business day (idempotent). The scheduled cron does this automatically each morning for
            the prior day. Leave blank for yesterday.
          </p>
          <div className="row">
            <div className="field">
              <label>Date (America/Chicago)</label>
              <input type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} />
            </div>
            <div className="field" style={{ display: "flex", alignItems: "flex-end" }}>
              <button className="btn btn-ghost" onClick={runClose} disabled={busy}>
                {busy ? "Running…" : "Run close"}
              </button>
            </div>
          </div>
          {lastClose && (
            <div className="consent-box" style={{ marginTop: 4 }}>
              <strong>{lastClose.entry_date}</strong> — gross {usd(lastClose.gross_revenue_cents)} − Stripe fees{" "}
              {usd(lastClose.stripe_fees_cents)} − recurring {usd(lastClose.recurring_costs_cents)} − Twilio{" "}
              {usd(lastClose.twilio_cost_cents)} − one-time {usd(lastClose.one_time_costs_cents)} ={" "}
              <strong>net {usd(lastClose.net_profit_cents)}</strong>
              {" → "}
              {lastClose.is_loss_day
                ? "loss day, $0 reserved"
                : `tithe ${usd(lastClose.tithe_cents)} reserved`}
              {lastClose.stripe_error ? ` (Stripe unavailable: ${lastClose.stripe_error})` : ""}
            </div>
          )}
        </div>
      )}

      <h2 style={{ margin: "8px 0 10px" }}>Recent daily closes</h2>
      <div className="sim-scroll">
        <table className="table" style={{ marginBottom: 22 }}>
          <thead>
            <tr>
              <th>Date</th><th>Gross</th><th>Stripe fees</th><th>Recurring</th><th>Twilio</th><th>One-time</th>
              <th>Net profit</th><th>Tithe (10%)</th>
            </tr>
          </thead>
          <tbody>
            {summary.recentLedger.length === 0 && (
              <tr><td colSpan={8} className="muted">No closes yet — run one above or wait for the cron.</td></tr>
            )}
            {summary.recentLedger.map((r) => (
              <tr key={r.entry_date}>
                <td className="mono">{r.entry_date}</td>
                <td>{usd(r.gross_revenue_cents)}</td>
                <td>{usd(r.stripe_fees_cents)}</td>
                <td>{usd(r.recurring_costs_cents)}</td>
                <td>{usd(r.twilio_cost_cents)}</td>
                <td>{usd(r.one_time_costs_cents)}</td>
                <td style={{ color: r.net_profit_cents < 0 ? "var(--igy-error-text)" : undefined }}>{usd(r.net_profit_cents)}</td>
                <td style={{ fontWeight: 700 }}>{usd(r.tithe_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={{ margin: "8px 0 10px" }}>Disbursements</h2>
      <div className="sim-scroll">
        <table className="table">
          <thead>
            <tr><th>Date</th><th>Charity</th><th>Amount</th><th>Reference</th><th>Notes</th></tr>
          </thead>
          <tbody>
            {summary.recentDisbursements.length === 0 && (
              <tr><td colSpan={5} className="muted">No disbursements recorded.</td></tr>
            )}
            {summary.recentDisbursements.map((d) => (
              <tr key={d.id}>
                <td className="mono">{d.disbursed_on}</td>
                <td>{d.charity_name}</td>
                <td>{usd(d.amount_cents)}</td>
                <td className="muted">{d.reference ?? "—"}</td>
                <td className="muted">{d.notes ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
