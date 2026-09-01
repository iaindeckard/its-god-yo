"use client";

import { useState } from "react";
import Link from "next/link";
import KjvSourceBlock from "@/components/KjvSourceBlock";
import type { ReviewSlot, ReviewLangSide } from "@/lib/reviewQueue";
import { reasonsFor, OTHER_KEY } from "@/lib/rejectionReasons";

interface Perms { approve: boolean; rejectVerse: boolean; rejectTranslation: boolean; }

const REASON_PILL: Record<string, string> = {
  ai_disagreement: "AI disagreement",
  incomplete_sentence: "Incomplete sentence",
};

export default function ReviewQueue({
  initialSlots,
  perms,
}: {
  initialSlots: ReviewSlot[];
  perms: Perms;
}) {
  const [slots, setSlots] = useState<ReviewSlot[]>(initialSlots);
  const [session, setSession] = useState<{ id: string; started_at: string } | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/admin/review");
    const data = await res.json();
    if (res.ok) setSlots(data.slots);
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
        <h1>Review queue</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <Link className="btn btn-ghost" href="/admin/review/batch">Full batch view →</Link>
          {session ? (
            <button className="btn btn-ghost" onClick={() => sessionAction("end")}>End session</button>
          ) : (
            <button className="btn btn-primary" onClick={() => sessionAction("start")}>Start review session</button>
          )}
        </div>
      </div>

      {session && (
        <div className="admin-note">
          Review session active (<span className="mono">{session.id.slice(0, 8)}…</span>). Verse rejections during this
          session must be resolved before ending, or they escalate to super_admin.
        </div>
      )}
      {banner && <div className="admin-note">{banner}</div>}
      {error && <div className="error">{error}</div>}

      <p className="muted" style={{ marginTop: -8, marginBottom: 18 }}>
        {slots.length} slot(s) flagged for review. Actions call the existing review Edge Functions — nothing is
        reimplemented here. English and Spanish each have their own approve / reject-translation actions; Spanish has
        no separate &ldquo;reject verse&rdquo; action since the verse itself (verse_ref) is a shared, English-side
        decision — only the translation quality is Spanish-specific.
      </p>

      {slots.length === 0 && <div className="card">Nothing in the queue. 🎉</div>}

      {slots.map((slot) => (
        <SlotCard key={slot.id} slot={slot} perms={perms} sessionId={session?.id ?? null} onChanged={refresh} onError={setError} />
      ))}
    </>
  );
}

function SlotCard({
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
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <span className="mono" style={{ fontWeight: 700, fontSize: 16 }}>{slot.verse_ref}</span>
          <span className="muted" style={{ marginLeft: 10, fontSize: 13 }}>{slot.scheduled_date}</span>
        </div>
      </div>

      <KjvSourceBlock text={slot.source_text} />

      <div className="grid cols-2" style={{ marginTop: 12 }}>
        <LangPanel label="English" side={slot.en} />
        <LangPanel label="Spanish" side={slot.es} />
      </div>

      {slot.en.flagged && (
        <LangActions lang="en" slotId={slot.id} side={slot.en} perms={perms} sessionId={sessionId} onChanged={onChanged} onError={onError} />
      )}
      {slot.es.flagged && (
        <LangActions lang="es" slotId={slot.id} side={slot.es} perms={perms} sessionId={sessionId} onChanged={onChanged} onError={onError} />
      )}
      {!slot.en.flagged && !slot.es.flagged && (
        <div className="muted" style={{ marginTop: 14, fontSize: 13, borderTop: "1px solid var(--igy-line)", paddingTop: 14 }}>
          Neither dimension is flagged.
        </div>
      )}
    </div>
  );
}

/** Approve / reject-translation actions for one language dimension of a slot. English also gets reject-verse. */
function LangActions({
  lang,
  slotId,
  side,
  perms,
  sessionId,
  onChanged,
  onError,
}: {
  lang: "en" | "es";
  slotId: string;
  side: ReviewLangSide;
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

  const suffix = lang === "es" ? "-es" : "";

  async function call(path: string, payload: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/review/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ daily_slot_id: slotId, ...payload }),
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
    <div style={{ marginTop: 14, borderTop: "1px solid var(--igy-line)", paddingTop: 14 }}>
      <div className="muted" style={{ fontSize: 12, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {lang === "es" ? "Spanish" : "English"} actions
      </div>
      {rejectMode === null ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {perms.approve && (
            <>
              <button className="btn btn-primary" disabled={busy || !side.a} onClick={() => call(`approve${suffix}`, { chosen_output: "a" })}>Approve A</button>
              <button className="btn btn-primary" disabled={busy || !side.b} onClick={() => call(`approve${suffix}`, { chosen_output: "b" })}>Approve B</button>
            </>
          )}
          {perms.rejectTranslation && (
            <button className="btn btn-ghost" disabled={busy} onClick={() => setRejectMode("translation")}>Reject translation…</button>
          )}
          {lang === "en" && perms.rejectVerse && (
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
                  : call(`reject-translation${suffix}`, { corrected_translation: corrected, category, reason })
              }
            >
              {busy ? "Working…" : "Confirm"}
            </button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => { setRejectMode(null); setCategory(""); setReason(""); setCorrected(""); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function LangPanel({ label, side }: { label: string; side: ReviewLangSide }) {
  return (
    <div style={{ background: "var(--igy-bg-alt)", borderRadius: 10, padding: 14, border: "1px solid var(--igy-line)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <strong>{label}</strong>
        {side.flagged ? <span className="pill pill-warn">needs review</span> : <span className="pill pill-off">{side.status ?? "N/A"}</span>}
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
