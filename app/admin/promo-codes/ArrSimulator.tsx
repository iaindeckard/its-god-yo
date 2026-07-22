"use client";

import { useMemo, useState } from "react";

/**
 * ARR Impact Simulator (spec Part 2).
 *
 * The point the spec is emphatic about: a discount-depth slider ALONE only shows
 * revenue given up per redemption, which is NOT an ARR impact. Real ARR impact
 * needs a SECOND input — expected redemption volume per tier. So every tier row
 * here has BOTH a depth slider and an editable "expected redemptions", and the
 * impact is the product, aggregated per tier and in a running total.
 *
 *   per-tier annual impact = annualUnitValue × depth% × expectedRedemptions
 *   total                  = Σ per-tier impact
 *
 * `annualUnitCents` seeds each tier's annual value (individual-monthly annualized,
 * group a representative contract) and stays editable so Group in particular can
 * be modeled honestly. Expected-redemption defaults are pre-launch placeholders
 * (see lib/tiers.ts) — editable, meant to be replaced with the five-year
 * forecast's Year-1 numbers or live Stripe data.
 */
export interface SimTier {
  key: string;
  label: string;
  annualUnitCents: number;
  defaultExpectedRedemptions: number;
}

interface Row {
  annualUnitDollars: string;
  depthPct: number;
  expected: string;
}

const usd = (cents: number) =>
  `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

export default function ArrSimulator({ tiers }: { tiers: SimTier[] }) {
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(
      tiers.map((t) => [
        t.key,
        {
          annualUnitDollars: String(Math.round(t.annualUnitCents / 100)),
          depthPct: 0,
          expected: String(t.defaultExpectedRedemptions),
        },
      ]),
    ),
  );
  const [applyAll, setApplyAll] = useState("");

  function setRow(key: string, patch: Partial<Row>) {
    setRows((r) => ({ ...r, [key]: { ...r[key], ...patch } }));
  }

  function seedAllDepths() {
    const pct = Math.max(0, Math.min(100, Number(applyAll) || 0));
    setRows((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { ...v, depthPct: pct }])));
  }

  const computed = useMemo(() => {
    const per = tiers.map((t) => {
      const row = rows[t.key];
      const annualUnitCents = Math.round((Number(row.annualUnitDollars) || 0) * 100);
      const expected = Math.max(0, Math.floor(Number(row.expected) || 0));
      const perRedemptionCents = Math.round((annualUnitCents * row.depthPct) / 100);
      const impactCents = perRedemptionCents * expected;
      return { tier: t, row, perRedemptionCents, expected, impactCents };
    });
    const totalCents = per.reduce((s, p) => s + p.impactCents, 0);
    return { per, totalCents };
  }, [rows, tiers]);

  return (
    <div className="card arr-sim" style={{ marginBottom: 22 }}>
      <div className="admin-head" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>ARR Impact Simulator</h2>
        <div className="apply-all">
          <label style={{ fontSize: 12 }}>Set all tiers to</label>
          <input
            type="number"
            value={applyAll}
            min={0}
            max={100}
            onChange={(e) => setApplyAll(e.target.value)}
            style={{ width: 68 }}
            placeholder="%"
          />
          <button className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 13 }} onClick={seedAllDepths}>
            Apply %
          </button>
        </div>
      </div>
      <p className="muted" style={{ marginTop: 0, marginBottom: 16 }}>
        Estimated annualized revenue given up if a code with this depth is redeemed at the expected volume across each
        tier. Depth × annual value × expected redemptions — not just per-redemption discount. All inputs are editable
        assumptions.
      </p>

      <div className="sim-scroll">
        <table className="table sim-table">
          <thead>
            <tr>
              <th>Tier</th>
              <th>Annual value / redemption</th>
              <th style={{ minWidth: 200 }}>Discount depth</th>
              <th>Expected redemptions</th>
              <th style={{ textAlign: "right" }}>ARR impact</th>
            </tr>
          </thead>
          <tbody>
            {computed.per.map(({ tier, row, perRedemptionCents, impactCents }) => (
              <tr key={tier.key}>
                <td style={{ fontWeight: 600 }}>{tier.label}</td>
                <td>
                  <span className="dollar-input">
                    <span>$</span>
                    <input
                      type="number"
                      value={row.annualUnitDollars}
                      min={0}
                      onChange={(e) => setRow(tier.key, { annualUnitDollars: e.target.value })}
                      style={{ width: 90 }}
                    />
                    <span className="per">/yr</span>
                  </span>
                </td>
                <td>
                  <div className="depth-cell">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={row.depthPct}
                      onChange={(e) => setRow(tier.key, { depthPct: Number(e.target.value) })}
                    />
                    <span className="depth-val">{row.depthPct}%</span>
                  </div>
                  <div className="hint" style={{ marginTop: 2 }}>{usd(perRedemptionCents)} each</div>
                </td>
                <td>
                  <input
                    type="number"
                    value={row.expected}
                    min={0}
                    onChange={(e) => setRow(tier.key, { expected: e.target.value })}
                    style={{ width: 90 }}
                  />
                </td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                  {usd(impactCents)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="sim-total">
              <td colSpan={4} style={{ fontWeight: 700 }}>Total annual ARR impact</td>
              <td style={{ textAlign: "right", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
                {usd(computed.totalCents)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
