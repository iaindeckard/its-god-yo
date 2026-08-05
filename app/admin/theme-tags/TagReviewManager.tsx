"use client";

import { useState } from "react";
import type { TrackSummary, TagRow } from "@/lib/themeTags";

export default function TagReviewManager({
  initialSummaries,
  canReview,
}: {
  initialSummaries: TrackSummary[];
  canReview: boolean;
}) {
  const [summaries, setSummaries] = useState<TrackSummary[]>(initialSummaries);
  const [selected, setSelected] = useState<string | null>(null);
  const [tags, setTags] = useState<TagRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function refreshSummaries() {
    const res = await fetch("/api/admin/theme-tags");
    const data = await res.json();
    if (res.ok) setSummaries(data.summaries);
  }

  async function loadTrack(track: string) {
    setError(null); setSelected(track); setTags([]); setBusy(true);
    try {
      const res = await fetch(`/api/admin/theme-tags?track=${encodeURIComponent(track)}&status=proposed`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "load failed");
      setTags(data.tags);
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally { setBusy(false); }
  }

  async function propose(track: string) {
    setError(null); setNote(null); setBusy(true);
    try {
      const res = await fetch("/api/admin/theme-tags/propose", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme_track: track }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "propose failed");
      const r = data.result;
      setNote(`AI first pass on ${track}: sampled ${r.sampled ?? "?"}, proposed ${r.proposed ?? 0}.`);
      await Promise.all([refreshSummaries(), loadTrack(track)]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally { setBusy(false); }
  }

  async function review(id: string, decision: "approve" | "reject") {
    setError(null);
    const res = await fetch(`/api/admin/theme-tags/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error || "review failed"); return; }
    setTags((ts) => ts.filter((t) => t.id !== id)); // leaves the proposed queue
    refreshSummaries();
  }

  return (
    <>
      <div className="admin-head">
        <h1>Theme tag review</h1>
        <span className="dev-badge">AI proposes · you approve · generation uses approved only</span>
      </div>
      <p className="muted" style={{ marginTop: -12, marginBottom: 20 }}>
        Each themed track draws its daily verses only from verses you&rsquo;ve approved here. An AI first pass proposes
        candidates from the eligible pool; nothing is used until a human approves it — the same review-before-use safety
        model as the translation queue.
      </p>

      {error && <div className="error">{error}</div>}
      {note && <div className="admin-note">{note}</div>}

      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 24 }}>
        {summaries.map((t) => (
          <div key={t.key} className="kpi" style={{ cursor: "pointer", outline: selected === t.key ? "2px solid var(--igy-blue)" : "none" }} onClick={() => loadTrack(t.key)}>
            <div className="k-label">{t.label}</div>
            <div className="k-value" style={{ fontSize: 22 }}>{t.approved} <span style={{ fontSize: 13, fontWeight: 400 }}>approved</span></div>
            <div className="k-sub">{t.proposed} awaiting review · {t.rejected} rejected</div>
          </div>
        ))}
      </div>

      {selected && (
        <>
          <div className="admin-head" style={{ marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>{summaries.find((s) => s.key === selected)?.label} — proposed</h2>
            {canReview && (
              <button className="btn btn-ghost" disabled={busy} onClick={() => propose(selected)}>
                {busy ? "Working…" : "Run AI proposal"}
              </button>
            )}
          </div>
          <div className="sim-scroll">
            <table className="table">
              <thead>
                <tr><th>Verse</th><th>KJV text</th><th>Conf.</th><th>AI rationale</th>{canReview && <th></th>}</tr>
              </thead>
              <tbody>
                {tags.length === 0 && (
                  <tr><td colSpan={canReview ? 5 : 4} className="muted">
                    {busy ? "Loading…" : "No verses awaiting review. Run the AI proposal to generate candidates."}
                  </td></tr>
                )}
                {tags.map((t) => (
                  <tr key={t.id}>
                    <td className="mono" style={{ whiteSpace: "nowrap" }}>{t.verse_ref}</td>
                    <td style={{ maxWidth: 360 }}>{t.kjv_text ?? "N/A"}</td>
                    <td>{t.confidence != null ? t.confidence.toFixed(2) : "N/A"}</td>
                    <td className="muted" style={{ maxWidth: 200 }}>{t.rationale ?? "N/A"}</td>
                    {canReview && (
                      <td style={{ whiteSpace: "nowrap" }}>
                        <button className="btn btn-primary" style={{ padding: "6px 12px", fontSize: 13, marginRight: 6 }} onClick={() => review(t.id, "approve")}>Approve</button>
                        <button className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 13 }} onClick={() => review(t.id, "reject")}>Reject</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
