"use client";
import { useState, useTransition } from "react";
import type { SeasonReviewBatch, SeasonReviewItem } from "@/lib/seasons/reviewData";
import { loadBatchItems, approveSeasonItem, rejectSeasonItem } from "./actions";

export default function SeasonReviewClient({
  batches,
  perms,
}: {
  batches: SeasonReviewBatch[];
  perms: { approve: boolean; reject: boolean; generate: boolean };
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [items, setItems] = useState<Record<string, SeasonReviewItem[]>>({});
  const [counts, setCounts] = useState<Record<string, { approved: number; total: number; status: string }>>(
    Object.fromEntries(batches.map((b) => [b.id, { approved: b.approved_items, total: b.total_items, status: b.status }])),
  );
  const [pending, start] = useTransition();

  const open = (id: string) => {
    setOpenId(openId === id ? null : id);
    if (!items[id]) start(async () => { const r = await loadBatchItems(id); if (r.ok) setItems((s) => ({ ...s, [id]: r.items })); });
  };
  const act = (batchId: string, itemId: string, kind: "approve" | "reject") =>
    start(async () => {
      const r = kind === "approve" ? await approveSeasonItem(itemId) : await rejectSeasonItem(itemId, "off-theme");
      if (!r.ok) return;
      setItems((s) => ({ ...s, [batchId]: (s[batchId] ?? []).map((it) => (it.id === itemId ? { ...it, status: kind === "approve" ? "approved" : "rejected" } : it)) }));
      setCounts((c) => ({ ...c, [batchId]: { approved: r.approved, total: r.total, status: r.batchStatus } }));
    });

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <div className="admin-head"><h1>Season Review</h1></div>
      <p className="muted">The seasonal content batches (separate from the daily review queue). A batch is only chargeable once every item is approved.</p>
      {batches.length === 0 && <p className="muted">No season batches yet — they appear at T-30 before each season.</p>}
      {batches.map((b) => {
        const c = counts[b.id];
        const done = c.status === "approved";
        return (
          <div key={b.id} className="card" style={{ marginTop: 12 }}>
            <button onClick={() => open(b.id)} style={{ background: "none", border: "none", cursor: "pointer", textAlign: "left", width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span><strong>{b.season_key}</strong> {b.liturgical_year} · starts {b.season_start ?? "?"}</span>
              <span style={{ color: done ? "#1a7f37" : b.t14_alerted_at ? "#b45309" : "#555" }}>
                {c.approved}/{c.total} approved · {c.status}{b.t14_alerted_at && !done ? " · ⚠ T-14 alerted" : ""}
              </span>
            </button>
            {openId === b.id && (
              <div style={{ marginTop: 10 }}>
                {(items[b.id] ?? []).map((it) => (
                  <div key={it.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "6px 0", borderTop: "1px solid rgba(0,0,0,0.06)" }}>
                    <span style={{ fontSize: 13 }}>d{it.day_index + 1} · {it.send_date} · <strong>{it.verse_ref}</strong> — <span className="muted">{(it.verse_text ?? "").slice(0, 60)}</span></span>
                    <span style={{ whiteSpace: "nowrap" }}>
                      <em style={{ marginRight: 8, color: it.status === "approved" ? "#1a7f37" : it.status === "rejected" ? "#b91c1c" : "#666" }}>{it.status}</em>
                      {perms.approve && <button disabled={pending} onClick={() => act(b.id, it.id, "approve")}>Approve</button>}
                      {perms.reject && <button disabled={pending} onClick={() => act(b.id, it.id, "reject")} style={{ marginLeft: 6 }}>Reject</button>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
