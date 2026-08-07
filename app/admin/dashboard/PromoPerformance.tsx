"use client";

import { useState } from "react";
import type { PromoPerf } from "@/lib/dashboardMetrics";
import { Card, Modal } from "./ui";
import BarsChart from "./charts/BarsChart";
import { usd, usdFull, pct, INK, SLATE, POS, NEG, BRAND, CATEGORICAL } from "./charts/theme";

type SortKey = "netCents" | "mrrCents" | "conversions" | "arpuCents" | "discountCents";

/**
 * Promo code performance — individual performance, ranked comparison against other
 * codes, and impact on the recurring-revenue metrics (MRR / ARR / ARPU). Row click
 * drills into a single code. The "Show inactive codes" toggle (default hide) folds
 * in the earlier Promo-usage filter request.
 */
export default function PromoPerformance({
  perf, usage, totalMrrCents, activeSubs, canViewRevenue,
}: {
  perf: PromoPerf[];
  usage: { code: string; times_redeemed: number; active: boolean }[];
  totalMrrCents: number;
  activeSubs: number;
  canViewRevenue: boolean;
}) {
  const [showInactive, setShowInactive] = useState(false);
  const [sort, setSort] = useState<SortKey>("netCents");
  const [drill, setDrill] = useState<string | null>(null);

  const rows = perf
    .filter((p) => showInactive || p.active)
    .slice()
    .sort((a, b) => (b[sort] as number) - (a[sort] as number));

  // Impact on recurring revenue.
  const promoMrr = perf.filter((p) => p.active).reduce((s, p) => s + p.mrrCents, 0);
  const promoConversions = perf.reduce((s, p) => s + p.conversions, 0);
  const promoNet = perf.reduce((s, p) => s + p.netCents, 0);
  const promoDiscount = perf.reduce((s, p) => s + p.discountCents, 0);
  const promoArpu = promoConversions ? Math.round(promoMrr / promoConversions) : 0; // monthly, same basis as blended
  const blendedArpu = activeSubs ? Math.round(totalMrrCents / activeSubs) : 0;
  const mrrShare = totalMrrCents ? (promoMrr / totalMrrCents) * 100 : 0;
  const efficiency = promoDiscount ? promoNet / promoDiscount : null; // net $ per $1 discounted

  const selected = drill ? perf.find((p) => p.code === drill) ?? null : null;

  // If we have no performance rows at all (real data pre-launch), fall back to the
  // simple redemptions list so the widget still shows something truthful.
  const hasPerf = perf.some((p) => p.signups > 0 || p.netCents > 0);

  return (
    <div className="dash-grid">
      <Card
        span={4}
        title="Promo code performance"
        subtitle="individual performance, ranked against each other, and impact on MRR / ARR / ARPU"
        right={
          <label className="dash-toggle">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show inactive codes
          </label>
        }
      >
        {/* Impact strip */}
        {canViewRevenue && (
          <div className="promo-impact">
            <Impact label="MRR from promo cohorts" value={usd(promoMrr)} sub={`${mrrShare.toFixed(0)}% of total MRR`} color={BRAND} />
            <Impact label="ARR from promo cohorts" value={usd(promoMrr * 12)} sub="MRR × 12" color={CATEGORICAL[3]} />
            <Impact label="Promo ARPU vs blended" value={usd(promoArpu)} sub={`blended ${usd(blendedArpu)} · ${promoArpu >= blendedArpu ? "+" : ""}${blendedArpu ? Math.round(((promoArpu - blendedArpu) / blendedArpu) * 100) : 0}%`} color={promoArpu >= blendedArpu ? POS : NEG} />
            <Impact label="Discount given" value={usd(promoDiscount)} sub={efficiency != null ? `${efficiency.toFixed(1)}× net per $1 off` : "—"} color={CATEGORICAL[2]} />
          </div>
        )}

        {hasPerf ? (
          <>
            {/* Ranked comparison bar — codes against each other */}
            <div style={{ marginTop: 8 }}>
              <div className="dash-card-sub" style={{ marginBottom: 4 }}>
                Ranked by {sort === "netCents" ? "net revenue" : sort === "mrrCents" ? "MRR contribution" : sort === "conversions" ? "conversions" : sort === "arpuCents" ? "ARPU" : "discount given"}
                {" · "}
                <SortPick sort={sort} setSort={setSort} canViewRevenue={canViewRevenue} />
              </div>
              <BarsChart
                data={rows.map((r) => ({ label: r.code, value: r[sort] as number })) as unknown as Record<string, unknown>[]}
                xKey="label" barKey="value" horizontal colorful
                valueFormat={sort === "conversions" ? (v) => `${v}` : usd}
                height={Math.max(140, rows.length * 34)}
                onBarClick={(code) => setDrill(code)}
              />
            </div>

            {/* Comparative table */}
            <div className="dash-scroll" style={{ marginTop: 12 }}>
              <table className="table promo-table">
                <thead>
                  <tr>
                    <th>Code</th><th>Depth</th><th>Signups</th><th>Conv.</th><th>Conv %</th>
                    {canViewRevenue && <><th>Net rev</th><th>MRR</th><th>ARPU</th><th>Discount</th></>}
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const conv = r.signups ? (r.conversions / r.signups) * 100 : 0;
                    return (
                      <tr key={r.code} onClick={() => setDrill(r.code)} style={{ cursor: "pointer" }}>
                        <td className="mono">{r.code}{r.label ? <div className="promo-sublabel">{r.label}</div> : null}</td>
                        <td>{r.discountPct != null ? `${r.discountPct}%` : "—"}</td>
                        <td>{r.signups}</td>
                        <td>{r.conversions}</td>
                        <td><span style={{ color: conv >= 60 ? POS : conv >= 40 ? INK : NEG, fontWeight: 600 }}>{pct(conv, 0)}</span></td>
                        {canViewRevenue && <><td>{usdFull(r.netCents)}</td><td>{usdFull(r.mrrCents)}</td><td>{usdFull(r.arpuCents)}</td><td className="muted">{usdFull(r.discountCents)}</td></>}
                        <td>{r.active ? <span className="pill pill-on">active</span> : <span className="pill pill-off">inactive</span>}</td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && <tr><td colSpan={canViewRevenue ? 10 : 6} className="muted">No {showInactive ? "" : "active "}promo codes.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          // Pre-launch fallback: redemptions only.
          <ul className="breakdown" style={{ marginTop: 8 }}>
            {(showInactive ? usage : usage.filter((u) => u.active)).map((u, i) => (
              <li key={`${u.code}-${i}`}><span className="mono">{u.code} {u.active ? "" : "(inactive)"}</span><span>{u.times_redeemed} redeemed</span></li>
            ))}
            {usage.length === 0 && <li className="muted">No promo codes.</li>}
          </ul>
        )}
      </Card>

      {/* Per-code drill-down */}
      <Modal open={selected != null} onClose={() => setDrill(null)} title={selected ? `${selected.code}${selected.label ? ` · ${selected.label}` : ""}` : ""}>
        {selected && (
          <div>
            <div className="promo-impact">
              <Impact label="Conversions" value={`${selected.conversions}`} sub={`of ${selected.signups} signups · ${pct(selected.signups ? (selected.conversions / selected.signups) * 100 : 0, 0)}`} color={BRAND} />
              {canViewRevenue && <Impact label="Net revenue" value={usd(selected.netCents)} sub={`gross ${usd(selected.grossCents)}`} color={POS} />}
              {canViewRevenue && <Impact label="MRR contribution" value={usd(selected.mrrCents)} sub={`ARR ${usd(selected.mrrCents * 12)}`} color={CATEGORICAL[5]} />}
              {canViewRevenue && <Impact label="ARPU" value={usd(selected.arpuCents)} sub={`blended ${usd(blendedArpu)}`} color={selected.arpuCents >= blendedArpu ? POS : NEG} />}
            </div>
            {canViewRevenue && (
              <p style={{ fontSize: 13, color: SLATE, marginTop: 12 }}>
                Gave away <strong style={{ color: INK }}>{usdFull(selected.discountCents)}</strong> in discount to earn{" "}
                <strong style={{ color: INK }}>{usdFull(selected.netCents)}</strong> net —{" "}
                {selected.discountCents ? (selected.netCents / selected.discountCents).toFixed(1) : "∞"}× return per dollar discounted.
                {" "}This code&rsquo;s ARPU is{" "}
                <strong style={{ color: selected.arpuCents >= blendedArpu ? POS : NEG }}>
                  {blendedArpu ? `${selected.arpuCents >= blendedArpu ? "+" : ""}${Math.round(((selected.arpuCents - blendedArpu) / blendedArpu) * 100)}%`  : "—"}
                </strong>{" "}vs the blended average.
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function Impact({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="impact-tile" style={{ borderTopColor: color }}>
      <div className="impact-label">{label}</div>
      <div className="impact-value">{value}</div>
      <div className="impact-sub">{sub}</div>
    </div>
  );
}

function SortPick({ sort, setSort, canViewRevenue }: { sort: SortKey; setSort: (s: SortKey) => void; canViewRevenue: boolean }) {
  const opts: [SortKey, string][] = canViewRevenue
    ? [["netCents", "net revenue"], ["mrrCents", "MRR"], ["conversions", "conversions"], ["arpuCents", "ARPU"], ["discountCents", "discount"]]
    : [["conversions", "conversions"]];
  return (
    <>
      {opts.map(([k, l]) => (
        <button key={k} className={`sort-pick${sort === k ? " on" : ""}`} onClick={() => setSort(k)}>{l}</button>
      ))}
    </>
  );
}
