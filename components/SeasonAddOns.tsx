"use client";
import { useState, useTransition } from "react";
import { SEASON_KEYS, SEASON_PRODUCTS, seasonPriceLabel } from "@/lib/seasons/catalog";
import type { SeasonKey } from "@/lib/seasons/liturgical";

type ToggleFn = (input: { customerId: string; token: string; seasonKey: SeasonKey; active: boolean }) => Promise<{ ok: boolean; error?: string }>;

/**
 * Whole-family season add-on selector (no per-child selection — deferred per spec).
 * Each season is a single on/off toggle that applies to every teen on the account.
 */
export default function SeasonAddOns({
  customerId,
  token,
  initial,
  onToggle,
}: {
  customerId: string;
  token: string;
  initial: Record<string, { status: string }>;
  onToggle: ToggleFn;
}) {
  const [state, setState] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<SeasonKey | null>(null);

  const toggle = (k: SeasonKey) => {
    const active = state[k]?.status !== "active";
    setBusy(k);
    startTransition(async () => {
      const r = await onToggle({ customerId, token, seasonKey: k, active });
      if (r.ok) setState((s) => ({ ...s, [k]: { status: active ? "active" : "canceled" } }));
      setBusy(null);
    });
  };

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: 20 }}>
      <h1>Holy Season add-ons</h1>
      <p style={{ color: "#555" }}>Whole-family — each add-on applies to every teen on your account. Add or remove any time.</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
        {SEASON_KEYS.map((k) => {
          const on = state[k]?.status === "active";
          return (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", border: "1px solid #e5e5e5", borderRadius: 10, padding: "12px 14px" }}>
              <div>
                <div style={{ fontWeight: 600 }}>{SEASON_PRODUCTS[k].label}</div>
                <div style={{ fontSize: 13, color: "#666" }}>{seasonPriceLabel(k)}/yr per teen · charged just before the season starts</div>
              </div>
              <button
                onClick={() => toggle(k)}
                disabled={pending && busy === k}
                aria-pressed={on}
                style={{ minWidth: 96, padding: "8px 12px", borderRadius: 8, border: "1px solid", borderColor: on ? "#1a7f37" : "#888", background: on ? "#e6f4ea" : "#fff", color: on ? "#1a7f37" : "#333", fontWeight: 600, cursor: "pointer" }}
              >
                {busy === k ? "…" : on ? "On ✓" : "Add"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
