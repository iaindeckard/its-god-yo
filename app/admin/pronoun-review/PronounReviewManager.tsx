"use client";

import { useState } from "react";
import type { PronounProposal, PronounProposalSummary } from "@/lib/pronounReview";

/**
 * Highlight the words the proposal changed. Original and proposed differ ONLY in
 * the casing of divine pronouns (validated at draft time), so the two token lists
 * align 1:1 — mark any token whose casing changed.
 */
function Highlighted({ original, proposed }: { original: string; proposed: string }) {
  const o = original.split(/(\s+)/);
  const p = proposed.split(/(\s+)/);
  return (
    <>
      {p.map((tok, i) =>
        tok !== o[i] ? (
          <mark key={i} style={{ background: "var(--igy-gold, #FFDC52)", color: "#1a1a1a", padding: "0 2px", borderRadius: 3 }}>{tok}</mark>
        ) : (
          <span key={i}>{tok}</span>
        ),
      )}
    </>
  );
}

export default function PronounReviewManager({
  initialSummary,
  initialProposals,
  canReview,
}: {
  initialSummary: PronounProposalSummary;
  initialProposals: PronounProposal[];
  canReview: boolean;
}) {
  const [summary, setSummary] = useState<PronounProposalSummary>(initialSummary);
  const [proposals, setProposals] = useState<PronounProposal[]>(initialProposals);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function review(id: string, decision: "approve" | "reject") {
    setError(null);
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/pronoun-review/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "review failed");
      setProposals((ps) => ps.filter((p) => p.id !== id));
      setSummary((s) => ({
        proposed: s.proposed - 1,
        approved: s.approved + (decision === "approve" ? 1 : 0),
        rejected: s.rejected + (decision === "reject" ? 1 : 0),
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="admin-head">
        <h1>Divine-pronoun corrections</h1>
        <span className="dev-badge">AI proposes · you approve · nothing is applied until you approve</span>
      </div>
      <p className="muted" style={{ marginTop: -12, marginBottom: 20 }}>
        Each of these approved daily verses has a lowercase pronoun (he / him / his) that the fidelity judge read as
        referring to God. Pronoun cases need a human eye &mdash; a &ldquo;he&rdquo; in the same verse can refer to a
        person &mdash; so nothing here is auto-corrected. Approving writes the highlighted correction to the live verse
        and clears the flag; rejecting leaves the verse exactly as it is.
      </p>

      {error && <div className="error">{error}</div>}

      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 24 }}>
        <div className="kpi"><div className="k-label">Awaiting review</div><div className="k-value">{summary.proposed}</div></div>
        <div className="kpi"><div className="k-label">Approved</div><div className="k-value">{summary.approved}</div></div>
        <div className="kpi"><div className="k-label">Rejected</div><div className="k-value">{summary.rejected}</div></div>
      </div>

      <div className="sim-scroll">
        <table className="table">
          <thead>
            <tr>
              <th style={{ whiteSpace: "nowrap" }}>Verse</th>
              <th>Current (live)</th>
              <th>Proposed correction</th>
              {canReview && <th></th>}
            </tr>
          </thead>
          <tbody>
            {proposals.length === 0 && (
              <tr><td colSpan={canReview ? 4 : 3} className="muted">Nothing awaiting review.</td></tr>
            )}
            {proposals.map((p) => (
              <tr key={p.id}>
                <td className="mono" style={{ whiteSpace: "nowrap", verticalAlign: "top" }}>{p.verse_ref}</td>
                <td style={{ maxWidth: 340, verticalAlign: "top" }}>{p.original_text}</td>
                <td style={{ maxWidth: 340, verticalAlign: "top" }}><Highlighted original={p.original_text} proposed={p.proposed_text} /></td>
                {canReview && (
                  <td style={{ whiteSpace: "nowrap", verticalAlign: "top" }}>
                    <button className="btn btn-primary" style={{ padding: "6px 12px", fontSize: 13, marginRight: 6 }} disabled={busyId === p.id} onClick={() => review(p.id, "approve")}>Approve</button>
                    <button className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 13 }} disabled={busyId === p.id} onClick={() => review(p.id, "reject")}>Reject</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
