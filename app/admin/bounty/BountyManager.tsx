"use client";

import { useState } from "react";
import type { ReviewGroup, BountyLedger, CorrectionRow } from "@/lib/bounty";

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");
const truncate = (s: string | null, n = 90) => (s ? (s.length > n ? s.slice(0, n) + "…" : s) : "—");

export default function BountyManager({
  initialGroups,
  initialLedger,
  initialCorrections,
  canReview,
  canPublish,
}: {
  initialGroups: ReviewGroup[];
  initialLedger: BountyLedger;
  initialCorrections: CorrectionRow[];
  canReview: boolean;
  canPublish: boolean;
}) {
  const [groups, setGroups] = useState<ReviewGroup[]>(initialGroups);
  const [ledger, setLedger] = useState<BountyLedger>(initialLedger);
  const [corrections, setCorrections] = useState<CorrectionRow[]>(initialCorrections);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // group_key currently working

  async function refresh() {
    const res = await fetch("/api/admin/bounty");
    const data = await res.json();
    if (res.ok) { setGroups(data.groups); setLedger(data.ledger); setCorrections(data.corrections); }
  }

  async function call(url: string, body: object, gk: string): Promise<{ ok: boolean; data: { error?: string; result?: Record<string, unknown> } }> {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    return { ok: res.ok, data };
  }

  async function assess(gk: string) {
    setError(null); setNote(null); setBusy(gk);
    try {
      const { ok, data } = await call("/api/admin/bounty/assess", { group_key: gk }, gk);
      if (!ok) throw new Error(data.error || "assessment failed");
      const r = data.result!;
      setNote(r.slot_error ? `Assessed: ${r.ai_assessment}` : `Assessed — AI says ${r.ai_is_error ? "this IS likely an error" : "this is probably fine"}. Review the draft below.`);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "error"); } finally { setBusy(null); }
  }

  async function publish(g: ReviewGroup) {
    const finalText = (edits[g.group_key] ?? g.assessment?.ai_proposed_fix ?? "").trim();
    if (!finalText) { setError("Nothing to publish — assess first or type a correction."); return; }
    setError(null); setNote(null); setBusy(g.group_key);
    try {
      const { ok, data } = await call("/api/admin/bounty/publish", { group_key: g.group_key, final_text: finalText }, g.group_key);
      if (!ok) throw new Error(data.error || "publish failed");
      const reward = (data.result as { reward?: Record<string, unknown> })?.reward ?? {};
      setNote(
        reward.credited
          ? `Published to live content. ${usd(reward.credit_cents as number)} credit applied to ${reward.winner_email} — auto-reduces their next invoice.${reward.warning ? ` ⚠ ${reward.warning}` : ""}`
          : reward.capped
            ? `Published. ${reward.winner_email} was first but hit this year's cap — no new credit.`
            : reward.skipped
              ? `Published. Couldn't auto-credit ${reward.winner_email}: ${reward.skipped_reason} — logged for follow-up.`
              : `Published to live content.`,
      );
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "error"); } finally { setBusy(null); }
  }

  async function reject(gk: string) {
    setError(null); setNote(null); setBusy(gk);
    try {
      const { ok, data } = await call("/api/admin/bounty/review", { group_key: gk, decision: "reject" }, gk);
      if (!ok) throw new Error(data.error || "reject failed");
      setNote(`Marked not an error (${(data.result as { report_count?: number })?.report_count} report(s)). Reporters were notified.`);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "error"); } finally { setBusy(null); }
  }

  async function revert(id: string) {
    setError(null); setNote(null); setBusy(id);
    try {
      const res = await fetch("/api/admin/bounty/revert", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ corrections_log_id: id }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "revert failed");
      setNote("Correction reverted — the live slot text was restored. (The reward credit is unchanged.)");
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "error"); } finally { setBusy(null); }
  }

  return (
    <>
      <div className="admin-head">
        <h1>Error bounty</h1>
        <span className="dev-badge">AI-assessed · human-approved publish · 1/12-annual reward</span>
      </div>
      <p className="muted" style={{ marginTop: -12, marginBottom: 20 }}>
        Subscribers report translation/wording issues, grouped by verse/date/track and text (English reword vs Spanish
        translation). <strong>Assess</strong> drafts an AI verdict + fix; you edit and <strong>Approve &amp; publish</strong>{" "}
        to push the correction to live content (super-admin only), which rewards the earliest reporter a credit worth one
        month of their plan. Nothing publishes without you.
      </p>

      {error && <div className="error">{error}</div>}
      {note && <div className="admin-note">{note}</div>}

      {/* Ledger summary */}
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 24 }}>
        <div className="kpi"><div className="k-label">Credit issued</div><div className="k-value">{usd(ledger.issuedCents)}</div><div className="k-sub">{ledger.issuedCount} credit(s)</div></div>
        <div className="kpi"><div className="k-label">Rewarded (YTD)</div><div className="k-value">{ledger.reporterYtd.length}</div><div className="k-sub">this calendar year</div></div>
        <div className="kpi"><div className="k-label">Needs follow-up</div><div className="k-value">{ledger.skippedCount + ledger.reconcileCount}</div><div className="k-sub">{ledger.skippedCount} skipped · {ledger.reconcileCount} reconcile</div></div>
      </div>

      {/* Review queue */}
      <h2 style={{ margin: "8px 0 12px" }}>Reports awaiting review</h2>
      {groups.length === 0 && <p className="muted" style={{ marginBottom: 24 }}>No reports awaiting review.</p>}
      {groups.map((g) => {
        const a = g.assessment;
        const working = busy === g.group_key;
        const draft = edits[g.group_key] ?? a?.ai_proposed_fix ?? "";
        return (
          <div key={g.group_key} className="card" style={{ marginBottom: 16 }}>
            <div className="admin-head" style={{ marginBottom: 8 }}>
              <div>
                <span className="mono" style={{ fontWeight: 700 }}>{g.verse_ref}</span>{" "}
                <span className="muted">· {g.report_date} · {g.theme_track} · {g.report_count} report(s)</span>{" "}
                <span className="pill pill-on">{g.text_lang === "es" ? "Spanish translation" : "English reword"}</span>
              </div>
              {canReview && (
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-ghost" style={{ padding: "7px 14px", fontSize: 13 }} disabled={!!busy} onClick={() => assess(g.group_key)}>{a ? "Re-assess" : "Assess"}</button>
                  <button className="btn btn-ghost" style={{ padding: "7px 14px", fontSize: 13 }} disabled={!!busy} onClick={() => reject(g.group_key)}>Not an error</button>
                </div>
              )}
            </div>

            {/* Live slot / current text */}
            {g.slot_ok ? (
              <div className="field" style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 12 }}>Currently live ({g.text_lang === "es" ? "final_translation_es" : "final_translation"})</label>
                <div className="muted" style={{ fontSize: 13 }}>{g.current_text || "(empty)"}</div>
              </div>
            ) : (
              <div className="error" style={{ fontSize: 13 }}>⚠ Can&rsquo;t target a slot ({g.slot_note}). Publishing is blocked until this resolves to exactly one daily_slot.</div>
            )}

            {/* Reports */}
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

            {/* AI assessment + publish */}
            {a && (
              <div className="card" style={{ marginTop: 10, background: "#fafafa" }}>
                <div style={{ marginBottom: 6 }}>
                  {a.ai_is_error === true && <span className="pill pill-on">AI: likely an error</span>}
                  {a.ai_is_error === false && <span className="pill pill-off">AI: probably fine</span>}
                  {a.ai_is_error === null && <span className="pill pill-warn">AI: couldn&rsquo;t assess</span>}
                  <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>assessed {when(a.ai_assessed_at)}</span>
                </div>
                {a.ai_assessment && <p style={{ fontSize: 13, marginTop: 0 }}>{a.ai_assessment}</p>}
                {a.ai_is_error && (
                  <div className="field">
                    <label style={{ fontSize: 12 }}>Proposed fix (edit before publishing)</label>
                    <textarea rows={3} value={draft} onChange={(e) => setEdits((s) => ({ ...s, [g.group_key]: e.target.value }))} />
                    {canPublish ? (
                      <button className="btn btn-primary" style={{ marginTop: 8, padding: "8px 16px", fontSize: 13 }} disabled={!!busy || !g.slot_ok || !draft.trim()} onClick={() => publish(g)}>
                        {working ? "Publishing…" : "Approve & publish"}
                      </button>
                    ) : (
                      <p className="hint" style={{ marginTop: 6 }}>Publishing requires the <span className="mono">content.queue.publish</span> permission (super-admin).</p>
                    )}
                  </div>
                )}
              </div>
            )}
            <p className="hint" style={{ marginTop: 8 }}>Approving publishes the fix live and rewards only the <strong>1st</strong> reporter, subject to their annual cap.</p>
          </div>
        );
      })}

      {/* Needs follow-up */}
      {ledger.followUps.length > 0 && (
        <>
          <h2 style={{ margin: "20px 0 4px" }}>⚠ Needs follow-up</h2>
          <div className="sim-scroll">
            <table className="table" style={{ marginBottom: 16 }}>
              <thead><tr><th>Type</th><th>Reporter</th><th>Owed</th><th>Why</th><th>Stripe refs</th></tr></thead>
              <tbody>
                {ledger.followUps.map((c) => (
                  <tr key={c.id}>
                    <td><span className="pill pill-warn">{c.status}</span></td>
                    <td className="mono">{c.reporter_email}</td>
                    <td style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{c.amount_cents > 0 ? usd(c.amount_cents) : "1 month"}</td>
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

      {/* Corrections history */}
      <h2 style={{ margin: "20px 0 10px" }}>Corrections published</h2>
      <div className="sim-scroll">
        <table className="table">
          <thead><tr><th>Verse</th><th>Action</th><th>Before → After</th><th>When</th>{canPublish && <th></th>}</tr></thead>
          <tbody>
            {corrections.length === 0 && <tr><td colSpan={canPublish ? 5 : 4} className="muted">No corrections published yet.</td></tr>}
            {corrections.map((c) => (
              <tr key={c.id}>
                <td className="mono">{c.original_verse_ref ?? "—"}</td>
                <td>{c.action_type === "bounty_revert" ? <span className="pill pill-off">revert</span> : <span className="pill pill-on">correction</span>}</td>
                <td style={{ maxWidth: 380, fontSize: 12 }}>
                  <div className="muted">&ldquo;{truncate(c.original_translation)}&rdquo;</div>
                  <div>→ &ldquo;{truncate(c.corrected_translation)}&rdquo;</div>
                </td>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{when(c.corrected_at)}</td>
                {canPublish && (
                  <td>{c.action_type === "bounty_correction" && (
                    <button className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 12 }} disabled={!!busy} onClick={() => revert(c.id)}>Revert</button>
                  )}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Credit ledger */}
      <h2 style={{ margin: "20px 0 10px" }}>Credit ledger</h2>
      <div className="sim-scroll">
        <table className="table">
          <thead><tr><th>Reporter</th><th>Amount</th><th>Issued</th><th>Status</th></tr></thead>
          <tbody>
            {ledger.recentCredits.length === 0 && <tr><td colSpan={4} className="muted">No credits issued yet.</td></tr>}
            {ledger.recentCredits.map((c) => (
              <tr key={c.id}>
                <td className="mono">{c.reporter_email}</td>
                <td>{c.amount_cents > 0 ? usd(c.amount_cents) : "—"}</td>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{when(c.issued_at)}</td>
                <td>
                  {c.status === "issued" && <span className="pill pill-on">issued</span>}
                  {c.status === "skipped" && <span className="pill pill-warn" title={c.skipped_reason ?? undefined}>needs follow-up</span>}
                  {c.status === "reconcile" && <span className="pill pill-warn" title={c.skipped_reason ?? undefined}>reconcile</span>}
                  {c.status === "reversed" && <span className="pill pill-off">reversed</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
