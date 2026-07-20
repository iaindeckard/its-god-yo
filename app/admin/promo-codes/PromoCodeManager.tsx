"use client";

import { useState } from "react";
import type { PromoCodeView } from "@/lib/promoCodes";

function discountLabel(c: PromoCodeView): string {
  if (c.percent_off != null) return `${c.percent_off}% off`;
  if (c.amount_off != null) return `$${(c.amount_off / 100).toFixed(2)} off`;
  return "—";
}
function redemptionLabel(c: PromoCodeView): string {
  return `${c.times_redeemed} / ${c.max_redemptions ?? "∞"}`;
}
function durationLabel(c: PromoCodeView): string {
  if (c.duration === "repeating") return `repeating ${c.duration_in_months ?? "?"}mo`;
  return c.duration;
}
function expiryLabel(c: PromoCodeView): string {
  return c.expires_at ? new Date(c.expires_at * 1000).toLocaleDateString() : "—";
}

export default function PromoCodeManager({
  initialCodes,
  canCreate,
  canDeactivate,
  canEdit,
}: {
  initialCodes: PromoCodeView[];
  canCreate: boolean;
  canDeactivate: boolean;
  canEdit: boolean;
}) {
  const [codes, setCodes] = useState<PromoCodeView[]>(initialCodes);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // form state
  const [discountType, setDiscountType] = useState<"percent" | "amount">("percent");
  const [value, setValue] = useState("");
  const [code, setCode] = useState("");
  const [duration, setDuration] = useState<"once" | "forever" | "repeating">("once");
  const [durationMonths, setDurationMonths] = useState("3");
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [note, setNote] = useState("");

  async function refresh() {
    const res = await fetch("/api/admin/promo-codes");
    const data = await res.json();
    if (res.ok) setCodes(data.promo_codes);
  }

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/promo-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discountType,
          value,
          code: code || undefined,
          duration,
          durationInMonths: duration === "repeating" ? durationMonths : undefined,
          maxRedemptions: maxRedemptions || undefined,
          expiresAt: expiresAt || undefined,
          note: note || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create");
      setCodes((c) => [data.promo_code, ...c]);
      setShowForm(false);
      setValue(""); setCode(""); setMaxRedemptions(""); setExpiresAt(""); setNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(id: string) {
    setError(null);
    const res = await fetch(`/api/admin/promo-codes/${id}/deactivate`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) { setError(data.error || "Failed"); return; }
    setCodes((cs) => cs.map((c) => (c.id === id ? data.promo_code : c)));
  }

  return (
    <>
      <div className="admin-head">
        <h1>Promo codes</h1>
        {canCreate && (
          <button className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>
            {showForm ? "Cancel" : "+ New promo code"}
          </button>
        )}
      </div>
      <p className="muted" style={{ marginTop: -12, marginBottom: 20 }}>
        Stripe-native Coupons + Promotion Codes. Dormant feature held in reserve — full per-code control.
      </p>

      {error && <div className="error">{error}</div>}

      {showForm && canCreate && (
        <div className="card" style={{ marginBottom: 22 }}>
          <div className="row">
            <div className="field">
              <label>Discount type</label>
              <div className="lang-toggle">
                <button className={discountType === "percent" ? "active" : ""} onClick={() => setDiscountType("percent")}>% off</button>
                <button className={discountType === "amount" ? "active" : ""} onClick={() => setDiscountType("amount")}>$ off</button>
              </div>
            </div>
            <div className="field">
              <label>{discountType === "percent" ? "Percent (1–100)" : "Amount (USD)"}</label>
              <input type="number" value={value} onChange={(e) => setValue(e.target.value)} min={1} placeholder={discountType === "percent" ? "20" : "10"} />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>Code (blank = auto-generated)</label>
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="WSULAUNCH" />
            </div>
            <div className="field">
              <label>Max redemptions (blank = unlimited)</label>
              <input type="number" value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)} min={1} placeholder="∞" />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>Applies for</label>
              <select value={duration} onChange={(e) => setDuration(e.target.value as typeof duration)}>
                <option value="once">Once (first invoice)</option>
                <option value="forever">Forever (every invoice)</option>
                <option value="repeating">Repeating (N months)</option>
              </select>
            </div>
            {duration === "repeating" ? (
              <div className="field">
                <label>Months</label>
                <input type="number" value={durationMonths} onChange={(e) => setDurationMonths(e.target.value)} min={1} />
              </div>
            ) : (
              <div className="field">
                <label>Expires (optional)</label>
                <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
              </div>
            )}
          </div>
          {duration === "repeating" && (
            <div className="field">
              <label>Expires (optional)</label>
              <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </div>
          )}
          <div className="field">
            <label>Internal note (for your reference — not shown to customers)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="WSU partnership launch code" />
          </div>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? "Creating…" : "Create promo code"}
          </button>
        </div>
      )}

      <table className="table">
        <thead>
          <tr>
            <th>Code</th><th>Discount</th><th>Applies</th><th>Redemptions</th><th>Expires</th><th>Status</th><th>Note</th>
            {canDeactivate && <th></th>}
          </tr>
        </thead>
        <tbody>
          {codes.length === 0 && (
            <tr><td colSpan={canDeactivate ? 8 : 7} className="muted">No promo codes yet.</td></tr>
          )}
          {codes.map((c) => (
            <tr key={c.id}>
              <td className="mono">{c.code}</td>
              <td>{discountLabel(c)}</td>
              <td>{durationLabel(c)}</td>
              <td>{redemptionLabel(c)}</td>
              <td>{expiryLabel(c)}</td>
              <td>{c.active ? <span className="pill pill-on">active</span> : <span className="pill pill-off">inactive</span>}</td>
              <td className="muted" style={{ maxWidth: 180 }}>{c.note ?? "—"}</td>
              {canDeactivate && (
                <td>
                  {c.active && (
                    <button className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 13 }} onClick={() => deactivate(c.id)}>
                      Deactivate
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint" style={{ marginTop: 10 }}>
        Deactivating soft-disables the code in Stripe (never hard-deletes a used code — reporting integrity).
        Codes are otherwise immutable in Stripe{canEdit ? "; the internal note can be edited via the API" : ""}.
      </p>
    </>
  );
}
