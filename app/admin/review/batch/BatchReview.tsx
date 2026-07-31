"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import KjvSourceBlock from "@/components/KjvSourceBlock";
import type { ReviewSlot, ReviewLangSide } from "@/lib/reviewQueue";
import type { BatchResult } from "@/lib/reviewBatch";
import { reasonsFor, OTHER_KEY } from "@/lib/rejectionReasons";

interface Perms { approve: boolean; rejectVerse: boolean; rejectTranslation: boolean; }

const REASON_PILL: Record<string, string> = {
  ai_disagreement: "AI disagreement",
  incomplete_sentence: "Incomplete sentence",
};

function isApproved(slot: ReviewSlot) {
  return slot.en.status === "approved" || slot.en.status === "sent";
}

export default function BatchReview({ result, perms }: { result: BatchResult; perms: Perms }) {
  const router = useRouter();
  const { slots, summary, track, from, to } = result;

  const [trackInput, setTrackInput] = useState(track);
  const [fromInput, setFromInput] = useState(from ?? "");
  const [toInput, setToInput] = useState(to ?? "");

  const [session, setSession] = useState<{ id: string; started_at: string } | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function applyFilters() {
    const p = new URLSearchParams();
    if (trackInput.trim()) p.set("track", trackInput.trim());
    if (fromInput.trim()) p.set("from", fromInput.trim());
    if (toInput.trim()) p.set("to", toInput.trim());
    router.push(`/admin/review/batch?${p.toString()}`);
  }

  async function sessionAction(action: "start" | "end", extra: Record<string, unknown> = {}) {
    setError(null);
    const res = await fetch("/api/admin/review/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error || "Session error"); return; }
    if (action === "start") {
      setSession({ id: data.review_session_id, started_at: data.started_at });
      setBanner(null);
    } else {
      setSession(null);
      setBanner(
        data.ended_cleanly
          ? "Session ended cleanly."
          : `Session ended — ${data.escalated_slot_ids.length} unresolved slot(s) escalated to super_admin.`,
      );
    }
  }

  return (
    <>
      <div className="admin-head">
        <h1>Batch review</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <Link className="btn btn-ghost" href="/admin/review">Exceptions queue →</Link>
          {session ? (
            <button className="btn btn-ghost" onClick={() => sessionAction("end")}>End session</button>
          ) : (
            <button className="btn btn-primary" onClick={() => sessionAction("start")}>Start review session</button>
          )}
        </div>
      </div>

      <p className="muted" style={{ marginTop: -8, marginBottom: 14 }}>
        Every scheduled slot for this track — <strong>approved and not-yet-approved alike</strong> — so you can review the
        whole batch, not just AI-flagged exceptions. Actions apply to the <strong>English</strong> dimension; the Spanish
        side is shown for visibility only.
      </p>

      {/* Filters */}
      <div className="card" style={{ marginBottom: 16, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div className="field" style={{ margin: 0 }}>
          <label>Track</label>
          <input value={trackInput} onChange={(e) => setTrackInput(e.target.value)} placeholder="general" style={{ width: 180 }} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>From (date)</label>
          <input type="date" value={fromInput} onChange={(e) => setFromInput(e.target.value)} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>To (date)</label>
          <input type="date" value={toInput} onChange={(e) => setToInput(e.target.value)} />
        </div>
        <button className="btn btn-primary" onClick={applyFilters}>Apply</button>
      </div>

      {/* Progress + status summary */}
      <div className="card" style={{ marginBottom: 18, display: "flex", gap: 18, alignItems: "baseline", flexWrap: "wrap" }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>{summary.approved} / {summary.total} approved</div>
        <span className="pill pill-off">{summary.agreed} agreed</span>
        <span className="pill pill-warn">{summary.needsReview} needs review</span>
        <span className="muted" style={{ fontSize: 13 }}>
          track <strong>{track}</strong>
          {from || to ? <> · {from ?? "…"} → {to ?? "…"}</> : <> · all dates</>}
        </span>
      </div>

      {session && (
        <div className="admin-note">
          Review session active (<span className="mono">{session.id.slice(0, 8)}…</span>). Verse rejections during this
          session must be resolved before ending, or they escalate to super_admin.
        </div>
      )}
      {banner && <div className="admin-note">{banner}</div>}
      {error && <div className="error">{error}</div>}

      {slots.length === 0 && <div className="card">No slots for this track / window.</div>}

      {slots.map((slot) => (
        <BatchSlotCard
          key={slot.id}
          slot={slot}
          perms={perms}
          sessionId={session?.id ?? null}
          onChanged={() => router.refresh()}
          onError={setError}
        />
      ))}
    </>
  );
}

function BatchSlotCard({
  slot,
  perms,
  sessionId,
  onChanged,
  onError,
}: {
  slot: ReviewSlot;
  perms: Perms;
  sessionId: string | null;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [rejectMode, setRejectMode] = useState<null | "verse" | "translation">(null);
  const [category, setCategory] = useState("");
  const [reason, setReason] = useState("");
  const [corrected, setCorrected] = useState("");

  const approved = isApproved(slot);

  async function call(path: string, payload: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/review/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ daily_slot_id: slot.id, ...payload }),
      });
      const data = await res.json();
      if (!res.ok) { onError(data.error || "Action failed"); return; }
      setRejectMode(null); setCategory(""); setReason(""); setCorrected("");
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 16, opacity: approved ? 0.72 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <span className="mono" style={{ fontWeight: 700, fontSize: 16 }}>{slot.verse_ref}</span>
          <span className="muted" style={{ marginLeft: 10, fontSize: 13 }}>{slot.scheduled_date}</span>
        </div>
        <StatusBadge status={slot.en.status} />
      </div>

      <KjvSourceBlock text={slot.source_text} />

      <div className="grid cols-2" style={{ marginTop: 12 }}>
        <LangPanel label="English" side={slot.en} />
        <LangPanel label="Spanish" side={slot.es} />
      </div>

      {approved ? (
        <div className="muted" style={{ marginTop: 14, fontSize: 13, borderTop: "1px solid var(--igy-line)", paddingTop: 14 }}>
          ✓ Approved — send-ready. Final: <strong>{slot.en.final ?? "—"}</strong>
        </div>
      ) : (
        <div style={{ marginTop: 14, borderTop: "1px solid var(--igy-line)", paddingTop: 14 }}>
          {rejectMode === null ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {perms.approve && (
                <>
                  <button className="btn btn-primary" disabled={busy || !slot.en.a} onClick={() => call("approve", { chosen_output: "a" })}>Approve A</button>
                  <button className="btn btn-primary" disabled={busy || !slot.en.b} onClick={() => call("approve", { chosen_output: "b" })}>Approve B</button>
                </>
              )}
              {perms.rejectTranslation && (
                <button className="btn btn-ghost" disabled={busy} onClick={() => setRejectMode("translation")}>Reject translation…</button>
              )}
              {perms.rejectVerse && (
                <button className="btn btn-ghost" disabled={busy} onClick={() => setRejectMode("verse")}>Reject verse…</button>
              )}
            </div>
          ) : (
            <div>
              <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>
                {rejectMode === "verse"
                  ? "Rejecting the verse regenerates both AI outputs (real AI cost)."
                  : "Supply the corrected final translation."}
              </div>
              {rejectMode === "translation" && (
                <textarea className="field" style={{ width: "100%", minHeight: 60 }} placeholder="Corrected translation" value={corrected} onChange={(e) => setCorrected(e.target.value)} />
              )}
              <select className="field" style={{ width: "100%" }} value={category} onChange={(e) => { setCategory(e.target.value); if (e.target.value !== OTHER_KEY) setReason(""); }}>
                <option value="">Reason…</option>
                {reasonsFor(rejectMode).map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
              {category === OTHER_KEY && (
                <input className="field" style={{ width: "100%", marginTop: 8 }} placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  className="btn btn-primary"
                  disabled={busy || !category || (category === OTHER_KEY && !reason.trim()) || (rejectMode === "translation" && !corrected.trim())}
                  onClick={() =>
                    rejectMode === "verse"
                      ? call("reject-verse", { category, reason, ...(sessionId ? { review_session_id: sessionId } : {}) })
                      : call("reject-translation", { corrected_translation: corrected, category, reason })
                  }
                >
                  {busy ? "Working…" : "Confirm"}
                </button>
                <button className="btn btn-ghost" disabled={busy} onClick={() => { setRejectMode(null); setCategory(""); setReason(""); setCorrected(""); }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (status === "approved" || status === "sent") return <span className="pill pill-off">✓ {status}</span>;
  if (status === "needs_review") return <span className="pill pill-warn">needs review</span>;
  if (status === "agreed") return <span className="pill pill-off">agreed</span>;
  return <span className="pill pill-off">{status ?? "—"}</span>;
}

function LangPanel({ label, side }: { label: string; side: ReviewLangSide }) {
  return (
    <div style={{ background: "var(--igy-bg-alt)", borderRadius: 10, padding: 14, border: "1px solid var(--igy-line)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <strong>{label}</strong>
        {side.flagged ? <span className="pill pill-warn">needs review</span> : <span className="pill pill-off">{side.status ?? "—"}</span>}
        {side.agreement && <span className="muted" style={{ fontSize: 12 }}>similarity: {side.agreement}</span>}
      </div>
      {side.reasons.length > 0 && (
        <div style={{ marginBottom: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
          {side.reasons.map((r) => <span key={r} className="pill pill-warn">{REASON_PILL[r] ?? r}</span>)}
        </div>
      )}
      <div style={{ fontSize: 13 }}>
        <div style={{ marginBottom: 6 }}><span className="muted">A (Claude):</span> {side.a ?? <em className="muted">none</em>}</div>
        <div><span className="muted">B (GPT-4o):</span> {side.b ?? <em className="muted">none</em>}</div>
        {side.final && <div style={{ marginTop: 6 }}><span className="muted">Final:</span> {side.final}</div>}
      </div>
    </div>
  );
}
