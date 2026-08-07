"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ReviewSlot } from "@/lib/reviewQueue";
import { reasonsFor, OTHER_KEY } from "@/lib/rejectionReasons";

interface Perms { approve: boolean; rejectVerse: boolean }

/**
 * Inline approve/reject for the TOP flagged review slots, right on the landing
 * page — reuses the exact /api/admin/review endpoints the full queue uses.
 * Actions operate on the English dimension (same as the full ReviewQueue); an
 * ES-only-flagged slot links out. Refreshes the page after each action.
 */
export default function AttentionReview({ slots, totalCount, perms }: { slots: ReviewSlot[]; totalCount: number; perms: Perms }) {
  return (
    <div className="attn-review">
      {slots.map((s) => <ReviewRow key={s.id} slot={s} perms={perms} />)}
      {totalCount > slots.length && (
        <Link href="/admin/review" className="attn-more">View all {totalCount} flagged →</Link>
      )}
    </div>
  );
}

function ReviewRow({ slot, perms }: { slot: ReviewSlot; perms: Perms }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [category, setCategory] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const enFlagged = slot.en.flagged;

  async function call(path: string, payload: Record<string, unknown>) {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/admin/review/${path}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ daily_slot_id: slot.id, ...payload }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || "Action failed"); return; }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="attn-verse">
      <div className="attn-verse-head">
        <span className="mono" style={{ fontWeight: 700 }}>{slot.verse_ref}</span>
        <span className="muted" style={{ fontSize: 12 }}>{slot.scheduled_date}{!enFlagged ? " · Spanish flagged" : ""}</span>
      </div>
      {slot.source_text && <div className="attn-verse-src">{slot.source_text}</div>}
      {enFlagged ? (
        <>
          <div className="attn-cands">
            <div className="attn-cand"><span className="attn-cand-tag">A</span>{slot.en.a ?? "—"}</div>
            <div className="attn-cand"><span className="attn-cand-tag">B</span>{slot.en.b ?? "—"}</div>
          </div>
          {err && <div className="error" style={{ margin: "6px 0" }}>{err}</div>}
          {!rejecting ? (
            <div className="attn-actions">
              {perms.approve && <>
                <button className="btn btn-primary btn-sm" disabled={busy || !slot.en.a} onClick={() => call("approve", { chosen_output: "a" })}>Approve A</button>
                <button className="btn btn-primary btn-sm" disabled={busy || !slot.en.b} onClick={() => call("approve", { chosen_output: "b" })}>Approve B</button>
              </>}
              {perms.rejectVerse && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setRejecting(true)}>Reject verse…</button>}
              <Link href="/admin/review" className="attn-more" style={{ marginLeft: "auto" }}>full review →</Link>
            </div>
          ) : (
            <div className="attn-actions" style={{ flexWrap: "wrap" }}>
              <select className="field" style={{ maxWidth: 220 }} value={category} onChange={(e) => { setCategory(e.target.value); if (e.target.value !== OTHER_KEY) setReason(""); }}>
                <option value="">Reason…</option>
                {reasonsFor("verse").map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
              {category === OTHER_KEY && <input className="field" style={{ maxWidth: 220 }} placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />}
              <button className="btn btn-primary btn-sm" disabled={busy || !category || (category === OTHER_KEY && !reason.trim())}
                onClick={() => call("reject-verse", { category, reason })}>Confirm reject</button>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setRejecting(false); setCategory(""); setReason(""); }}>Cancel</button>
            </div>
          )}
        </>
      ) : (
        <div className="attn-actions">
          <Link href="/admin/review" className="attn-more">Review Spanish flag →</Link>
        </div>
      )}
    </div>
  );
}
