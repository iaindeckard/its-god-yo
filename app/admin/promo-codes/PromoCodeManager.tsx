"use client";

import { useState } from "react";
import type { PromoCodeView } from "@/lib/promoCodes";
import ArrSimulator, { type SimTier } from "./ArrSimulator";

interface TierOption {
  key: string;
  label: string;
}
// Add-on options share the {key,label} shape with tiers.
type AddonOption = TierOption;

function discountLabel(c: PromoCodeView): string {
  if (c.percent_off != null) return `${c.percent_off}% off`;
  if (c.amount_off != null) return `$${(c.amount_off / 100).toFixed(2)} off`;
  return "N/A";
}
function redemptionLabel(c: PromoCodeView): string {
  return `${c.times_redeemed} / ${c.max_redemptions ?? "∞"}`;
}
function durationLabel(c: PromoCodeView): string {
  if (c.duration === "repeating") return `repeating ${c.duration_in_months ?? "?"}mo`;
  return c.duration;
}
function windowLabel(c: PromoCodeView): string {
  const s = c.starts_at ? new Date(c.starts_at * 1000).toLocaleDateString() : null;
  const e = c.expires_at ? new Date(c.expires_at * 1000).toLocaleDateString() : null;
  if (!s && !e) return "N/A";
  return `${s ?? "now"} → ${e ?? "∞"}`;
}
function tiersLabel(c: PromoCodeView, tierOptions: TierOption[]): string {
  if (c.allowed_tiers.length === 0) return "All tiers";
  return c.allowed_tiers
    .map((k) => tierOptions.find((t) => t.key === k)?.label ?? k)
    .join(", ");
}
function addonsLabel(c: PromoCodeView, addonOptions: AddonOption[]): string[] {
  return c.required_addons.map((k) => addonOptions.find((a) => a.key === k)?.label ?? k);
}

export default function PromoCodeManager({
  initialCodes,
  canCreate,
  canDeactivate,
  canEdit,
  canViewRevenue,
  tierOptions,
  addonOptions,
  simTiers,
}: {
  initialCodes: PromoCodeView[];
  canCreate: boolean;
  canDeactivate: boolean;
  canEdit: boolean;
  canViewRevenue: boolean;
  tierOptions: TierOption[];
  addonOptions: AddonOption[];
  simTiers: SimTier[];
}) {
  const [codes, setCodes] = useState<PromoCodeView[]>(initialCodes);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // form state
  const [label, setLabel] = useState("");
  const [discountType, setDiscountType] = useState<"percent" | "amount">("percent");
  const [value, setValue] = useState("");
  const [code, setCode] = useState("");
  const [duration, setDuration] = useState<"once" | "forever" | "repeating">("once");
  const [durationMonths, setDurationMonths] = useState("3");
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [maxPerCustomer, setMaxPerCustomer] = useState("1");
  const [firstTimeOnly, setFirstTimeOnly] = useState(true);
  const [startsAt, setStartsAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [allowedTiers, setAllowedTiers] = useState<string[]>([]);
  const [requiredAddons, setRequiredAddons] = useState<string[]>([]);
  const [requiresAttestation, setRequiresAttestation] = useState(false);
  const [attestationText, setAttestationText] = useState("");
  const [note, setNote] = useState("");

  function toggleTier(key: string) {
    setAllowedTiers((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  }
  function toggleAddon(key: string) {
    setRequiredAddons((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  }

  function resetForm() {
    setLabel(""); setValue(""); setCode(""); setMaxRedemptions(""); setMaxPerCustomer("1");
    setFirstTimeOnly(true); setStartsAt(""); setExpiresAt(""); setAllowedTiers([]); setRequiredAddons([]);
    setRequiresAttestation(false); setAttestationText(""); setNote("");
  }

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/promo-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          internalLabel: label || undefined,
          discountType,
          value,
          code: code || undefined,
          duration,
          durationInMonths: duration === "repeating" ? durationMonths : undefined,
          maxRedemptions: maxRedemptions || undefined,
          maxPerCustomer: maxPerCustomer || undefined,
          firstTimeOnly,
          startsAt: startsAt || undefined,
          expiresAt: expiresAt || undefined,
          allowedTiers,
          requiredAddons,
          requiresAttestation,
          attestationText: requiresAttestation ? attestationText : undefined,
          note: note || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create");
      setCodes((c) => [data.promo_code, ...c]);
      setShowForm(false);
      resetForm();
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
        <h1>Promo Code Studio</h1>
        {canCreate && (
          <button className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>
            {showForm ? "Cancel" : "+ New promo code"}
          </button>
        )}
      </div>
      <p className="muted" style={{ marginTop: -12, marginBottom: 20 }}>
        Real Stripe Coupons + Promotion Codes — Stripe stays the source of truth for what applies at checkout. Policy
        Stripe has no native field for (attestation, start date, per-customer cap, applicable tiers) is carried in
        metadata and enforced at validation.
      </p>

      {error && <div className="error">{error}</div>}

      {showForm && canCreate && (
        <div className="card" style={{ marginBottom: 22 }}>
          <div className="field">
            <label>Internal label (for your reference — not shown to customers)</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Episcopal Church — Summer 2026" />
          </div>

          <div className="row">
            <div className="field">
              <label>Discount type</label>
              <div className="lang-toggle">
                <button className={discountType === "percent" ? "active" : ""} onClick={() => setDiscountType("percent")}>% off</button>
                <button className={discountType === "amount" ? "active" : ""} onClick={() => setDiscountType("amount")}>$ off</button>
              </div>
            </div>
            <div className="field">
              <label>{discountType === "percent" ? "Discount depth — percent (1–100)" : "Amount (USD)"}</label>
              <input type="number" value={value} onChange={(e) => setValue(e.target.value)} min={1} placeholder={discountType === "percent" ? "15" : "10"} />
            </div>
          </div>

          <div className="row">
            <div className="field">
              <label>Code (blank = auto-generated)</label>
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="EPISCOPAL15" />
            </div>
            <div className="field">
              <label>Applies for (duration)</label>
              <select value={duration} onChange={(e) => setDuration(e.target.value as typeof duration)}>
                <option value="once">Once (first payment only)</option>
                <option value="forever">Forever (every invoice)</option>
                <option value="repeating">Repeating (N months)</option>
              </select>
            </div>
          </div>

          {duration === "repeating" && (
            <div className="field">
              <label>Months</label>
              <input type="number" value={durationMonths} onChange={(e) => setDurationMonths(e.target.value)} min={1} style={{ maxWidth: 160 }} />
            </div>
          )}

          <div className="row">
            <div className="field">
              <label>Max redemptions total (blank = unlimited)</label>
              <input type="number" value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)} min={1} placeholder="∞" />
            </div>
            <div className="field">
              <label>Max redemptions per customer</label>
              <input type="number" value={maxPerCustomer} onChange={(e) => setMaxPerCustomer(e.target.value)} min={1} placeholder="1" />
            </div>
          </div>

          <div className="row">
            <div className="field">
              <label>Active from (optional)</label>
              <input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </div>
            <div className="field">
              <label>Expires (optional)</label>
              <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </div>
          </div>

          <div className="field">
            <label>Applies to plan tiers (none selected = all tiers)</label>
            <div className="tier-checks">
              {tierOptions.map((t) => (
                <label key={t.key} className={`tier-chip ${allowedTiers.includes(t.key) ? "on" : ""}`}>
                  <input type="checkbox" checked={allowedTiers.includes(t.key)} onChange={() => toggleTier(t.key)} />
                  {t.label}
                </label>
              ))}
            </div>
          </div>

          {addonOptions.length > 0 && (
            <div className="field">
              <label>Requires these add-ons (none selected = no add-on required)</label>
              <div className="tier-checks">
                {addonOptions.map((a) => (
                  <label key={a.key} className={`tier-chip ${requiredAddons.includes(a.key) ? "on" : ""}`}>
                    <input type="checkbox" checked={requiredAddons.includes(a.key)} onChange={() => toggleAddon(a.key)} />
                    {a.label}
                  </label>
                ))}
              </div>
              <p className="hint" style={{ marginTop: 6 }}>
                The discount only applies when the buyer includes the selected add-on(s) at checkout — enforced at
                subscription creation, so it can never be redeemed without them.
              </p>
            </div>
          )}

          <label className="check-line">
            <input type="checkbox" checked={firstTimeOnly} onChange={(e) => setFirstTimeOnly(e.target.checked)} />
            First-time customers only (Stripe restriction — the closest native primitive to one-per-customer)
          </label>

          <label className="check-line">
            <input type="checkbox" checked={requiresAttestation} onChange={(e) => setRequiresAttestation(e.target.checked)} />
            Requires attestation at signup
          </label>
          {requiresAttestation && (
            <div className="field">
              <label>Attestation text shown at signup (logged with the consent record)</label>
              <textarea
                value={attestationText}
                onChange={(e) => setAttestationText(e.target.value)}
                rows={3}
                placeholder="I attest that I am an active member of an Episcopal congregation."
              />
            </div>
          )}

          <div className="field">
            <label>Internal note (optional, hidden from customers)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Affinity partnership — see IGY-Affinity-Promo-Codes doc" />
          </div>

          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? "Creating…" : "Create promo code"}
          </button>
        </div>
      )}

      {canViewRevenue ? (
        <ArrSimulator tiers={simTiers} />
      ) : (
        <p className="hint" style={{ marginBottom: 22 }}>
          🔒 ARR Impact Simulator requires the <span className="mono">analytics.revenue.view</span> permission.
        </p>
      )}

      <h2 style={{ margin: "8px 0 12px" }}>Existing codes</h2>
      <div className="sim-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Label</th><th>Code</th><th>Discount</th><th>Applies</th><th>Tiers</th>
              <th>Redemptions</th><th>Window</th><th>Rules</th><th>Status</th>
              {canDeactivate && <th></th>}
            </tr>
          </thead>
          <tbody>
            {codes.length === 0 && (
              <tr><td colSpan={canDeactivate ? 10 : 9} className="muted">No promo codes yet.</td></tr>
            )}
            {codes.map((c) => (
              <tr key={c.id}>
                <td style={{ maxWidth: 170 }}>{c.internal_label ?? c.note ?? "N/A"}</td>
                <td className="mono">{c.code}</td>
                <td>{discountLabel(c)}</td>
                <td>{durationLabel(c)}</td>
                <td className="muted" style={{ maxWidth: 160 }}>{tiersLabel(c, tierOptions)}</td>
                <td>{redemptionLabel(c)}</td>
                <td className="muted">{windowLabel(c)}</td>
                <td>
                  <div className="rule-badges">
                    {c.requires_attestation && <span className="pill">attest</span>}
                    {c.first_time_only && <span className="pill">first-time</span>}
                    {c.max_per_customer != null && <span className="pill">≤{c.max_per_customer}/cust</span>}
                    {addonsLabel(c, addonOptions).map((label) => (
                      <span key={label} className="pill">requires {label}</span>
                    ))}
                  </div>
                </td>
                <td>{c.active ? <span className="pill pill-on">active</span> : <span className="pill pill-off">inactive</span>}</td>
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
      </div>
      <p className="hint" style={{ marginTop: 10 }}>
        Deactivating soft-disables the code in Stripe (never hard-deletes a used code — reporting integrity).
        Discount math is immutable in Stripe{canEdit ? "; the internal label/note can be edited via the API" : ""}.
      </p>
    </>
  );
}
