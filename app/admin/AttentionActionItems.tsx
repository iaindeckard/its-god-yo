"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionItem } from "@/lib/actionItems";

const usd = (cents: number | null, cur: string | null) =>
  cents == null ? "" : `${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${(cur ?? "usd").toUpperCase()}`;

/** Inline resolve for billing/dispute action items on the landing page. */
export default function AttentionActionItems({ items }: { items: ActionItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function resolve(id: string) {
    setBusy(id); setErr(null);
    try {
      const res = await fetch(`/api/admin/action-items/${id}/resolve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || "Failed to resolve"); return; }
      router.refresh();
    } catch {
      setErr("Failed to resolve");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="attn-items">
      {err && <div className="error" style={{ margin: "4px 0" }}>{err}</div>}
      {items.map((it) => (
        <div key={it.id} className="attn-item">
          <div className="attn-item-body">
            <div className="attn-item-title">
              {it.title}
              {it.amount_cents != null && <span className="attn-amount">{usd(it.amount_cents, it.currency)}</span>}
            </div>
            {it.detail && <div className="attn-item-detail">{it.detail}</div>}
          </div>
          <button className="btn btn-ghost attn-resolve" disabled={busy === it.id} onClick={() => resolve(it.id)}>
            {busy === it.id ? "…" : "Resolve"}
          </button>
        </div>
      ))}
    </div>
  );
}
