"use client";

import { useState } from "react";
import type { DashboardMetrics } from "@/lib/dashboardMetrics";
import { Card, Delta, Modal } from "./ui";
import Sparkline from "./charts/Sparkline";
import TrendChart from "./charts/TrendChart";
import BarsChart from "./charts/BarsChart";
import DonutChart from "./charts/DonutChart";
import DivergingBars from "./charts/DivergingBars";
import FunnelChart from "./charts/FunnelChart";
import Heatmap from "./charts/Heatmap";
import PromoPerformance from "./PromoPerformance";
import { usd, usdFull, pct, compact, INK, SLATE, POS, NEG, BRAND, CATEGORICAL } from "./charts/theme";

const deltaPct = (arr: number[]): number | null => {
  if (arr.length < 2) return null;
  const first = arr[0], last = arr[arr.length - 1];
  if (!first) return null;
  return ((last - first) / Math.abs(first)) * 100;
};

export default function DashboardClient({ m, canViewRevenue }: { m: DashboardMetrics; canViewRevenue: boolean }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [revDrill, setRevDrill] = useState<string | null>(null);

  const subsSeries = m.mrrTrend.map((x) => x.activeSubs);

  const tiles: { key: string; label: string; value: string; spark: number[]; tone?: "auto"; color?: string; good?: boolean; delta: number | null }[] = [
    { key: "mrr", label: "MRR", value: usd(m.headline.mrrCents), spark: m.spark.mrr, color: BRAND, good: true, delta: deltaPct(m.spark.mrr) },
    { key: "net", label: `Net revenue · ${m.range}`, value: usd(m.headline.netRevenueCents), spark: m.spark.revenue, color: POS, good: true, delta: deltaPct(m.spark.revenue) },
    { key: "subs", label: "Active subscribers", value: `${m.headline.activeSubs}`, spark: subsSeries, color: CATEGORICAL[5], good: true, delta: deltaPct(subsSeries) },
    { key: "arpu", label: "ARPU", value: usd(m.headline.arpuCents), spark: m.spark.mrr.map((v, i) => (subsSeries[i] ? Math.round(v / subsSeries[i]) : 0)), color: CATEGORICAL[2], good: true, delta: null },
    { key: "signups", label: `New signups · ${m.range}`, value: `${m.headline.newSignups}`, spark: m.spark.signups, color: CATEGORICAL[1], good: true, delta: deltaPct(m.spark.signups) },
    { key: "churn", label: "Churn rate", value: pct(m.headline.churnRatePct), spark: m.spark.churn, color: NEG, good: false, delta: deltaPct(m.spark.churn) },
    { key: "delivery", label: "Send delivery", value: pct(m.headline.deliveryRatePct), spark: m.spark.delivery, color: POS, good: true, delta: deltaPct(m.spark.delivery) },
  ];

  return (
    <>
      {/* ---- At-a-glance strip: sparkline tiles, click to expand a full panel ---- */}
      <div className="stat-strip">
        {tiles.map((t) => (
          <button key={t.key} className={`stat-tile${expanded === t.key ? " active" : ""}`} onClick={() => setExpanded(expanded === t.key ? null : t.key)}>
            <div className="stat-top">
              <span className="stat-label">{t.label}</span>
              <Delta pct={t.delta} goodWhenUp={t.good} />
            </div>
            <div className="stat-value">{t.value}</div>
            <Sparkline data={t.spark} color={t.color} width={150} height={30} />
            <span className="stat-hint">{expanded === t.key ? "▲ hide" : "▾ expand"}</span>
          </button>
        ))}
      </div>

      {expanded && (
        <Card span={4} title={`${tiles.find((t) => t.key === expanded)?.label} — full trend (${m.range})`}>
          <ExpandedPanel which={expanded} m={m} />
        </Card>
      )}

      {/* ---------------- Revenue ---------------- */}
      <div className="dash-grid">
        <Card span={2} title="Net revenue trend" subtitle="Click a point for that period's plan + source breakdown" right={<Legend items={[["Net", POS], ["Gross", BRAND]]} />}>
          <TrendChart
            data={m.revenueTrend as unknown as Record<string, unknown>[]}
            series={[{ key: "netCents", label: "Net", color: POS }, { key: "grossCents", label: "Gross", color: BRAND }]}
            yFormat={usd}
            onPointClick={(d) => setRevDrill(d)}
          />
        </Card>
        <Card span={2} title="MRR / ARR & active subscribers" right={<Legend items={[["MRR", BRAND], ["Subs", CATEGORICAL[5]]]} />}>
          <TrendChart
            data={m.mrrTrend as unknown as Record<string, unknown>[]}
            series={[{ key: "mrrCents", label: "MRR", color: BRAND, kind: "line" }, { key: "activeSubs", label: "Subs", color: CATEGORICAL[5], kind: "line" }]}
            yFormat={(v) => (v > 1000 ? usd(v) : `${v}`)}
            legend={false}
          />
        </Card>
      </div>

      {/* ---------------- Growth & acquisition ---------------- */}
      <div className="dash-grid">
        <Card span={2} title="New signups" subtitle="per period">
          <BarsChart data={m.signups as unknown as Record<string, unknown>[]} xKey="label" barKey="signups" />
        </Card>
        <Card title="Acquisition by source" subtitle="which channel drove signups">
          <DonutChart
            data={m.acquisition.map((a) => ({ key: a.source, label: a.label, value: a.signups }))}
            centerLabel="signups"
            centerValue={`${m.acquisition.reduce((s, a) => s + a.signups, 0)}`}
          />
        </Card>
        <Card title="Signup → active funnel">
          <FunnelChart stages={m.funnel} />
        </Card>
      </div>

      {/* ---------------- Retention ---------------- */}
      <div className="dash-grid">
        <Card span={2} title="Churn & net change" subtitle="added vs churned, with net line — are we net-growing?">
          <DivergingBars data={m.churn} />
        </Card>
        <Card title="Plan mix" subtitle="active subscribers">
          <DonutChart data={m.planMix.map((p) => ({ key: p.key, label: p.label, value: p.count }))} centerLabel="subs" centerValue={`${m.planMix.reduce((s, p) => s + p.count, 0)}`} />
        </Card>
        <Card title="Focus track mix">
          <DonutChart data={m.themeMix.map((p) => ({ key: p.key, label: p.label, value: p.count }))} centerLabel="subs" centerValue={`${m.themeMix.reduce((s, p) => s + p.count, 0)}`} />
        </Card>
      </div>

      {/* ---------------- Delivery / ops health ---------------- */}
      <div className="dash-grid">
        <Card span={2} title="Delivery heatmap" subtitle="send volume by weekday × hour · red flag = failures">
          <Heatmap cells={m.deliveryHeat} />
        </Card>
        <Card title="Daily delivery" subtitle="delivered vs failed">
          <TrendChart
            data={m.delivery as unknown as Record<string, unknown>[]}
            series={[{ key: "delivered", label: "Delivered", color: POS }, { key: "failed", label: "Failed", color: NEG }]}
            legend
            height={200}
          />
        </Card>
        <Card title="SMS spend" subtitle="variable cost">
          <TrendChart data={m.smsSpend as unknown as Record<string, unknown>[]} series={[{ key: "cents", label: "Spend", color: CATEGORICAL[2] }]} yFormat={usd} legend={false} height={200} />
        </Card>
      </div>

      {/* ---------------- Content runway ---------------- */}
      <div className="dash-grid">
        <Card span={4} title="Content runway by track" subtitle="days of approved content ahead — red is out of runway (< 7 days)">
          <div className="runway-rows">
            {m.contentRunway.map((t) => {
              const d = t.runwayDays;
              const wpct = d == null ? 0 : Math.min(100, (d / 30) * 100);
              const color = d == null || d < 7 ? NEG : d < 14 ? "#E8912D" : POS;
              return (
                <div key={t.track} className="runway-row">
                  <span className="runway-label">{t.label}</span>
                  <div className="runway-bar"><span style={{ width: `${wpct}%`, background: color }} /></div>
                  <span className="runway-days" style={{ color }}>{d == null ? "empty" : `${d}d`}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* ---------------- Promo performance (folds in the show-inactive filter) ---------------- */}
      <PromoPerformance perf={m.promoPerf} usage={m.promoUsage} totalMrrCents={m.headline.mrrCents} activeSubs={m.headline.activeSubs} canViewRevenue={canViewRevenue} />

      {/* ---- Revenue drill-down modal ---- */}
      <Modal open={revDrill != null} onClose={() => setRevDrill(null)} title={revDrill ? `Breakdown · ${m.revenueTrend.find((r) => r.date === revDrill)?.label ?? revDrill}` : ""}>
        {revDrill && m.revenueDrill[revDrill] ? (
          <div className="dash-grid">
            <Card title="By plan">
              <BarsChart data={m.revenueDrill[revDrill].plan as unknown as Record<string, unknown>[]} xKey="label" barKey="count" horizontal colorful height={180} />
            </Card>
            <Card title="By source">
              <BarsChart data={m.revenueDrill[revDrill].source as unknown as Record<string, unknown>[]} xKey="label" barKey="count" horizontal colorful height={180} />
            </Card>
          </div>
        ) : (
          <p style={{ color: SLATE }}>No breakdown for this period.</p>
        )}
      </Modal>
    </>
  );
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div style={{ display: "flex", gap: 12 }}>
      {items.map(([label, color]) => (
        <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: SLATE }}>
          <span style={{ width: 10, height: 3, borderRadius: 2, background: color }} />{label}
        </span>
      ))}
    </div>
  );
}

function ExpandedPanel({ which, m }: { which: string; m: DashboardMetrics }) {
  switch (which) {
    case "mrr":
    case "subs":
      return <TrendChart data={m.mrrTrend as unknown as Record<string, unknown>[]} series={[{ key: "mrrCents", label: "MRR", color: BRAND }, { key: "arrCents", label: "ARR", color: CATEGORICAL[3], kind: "line", dashed: true }]} yFormat={usd} height={300} />;
    case "net":
      return <TrendChart data={m.revenueTrend as unknown as Record<string, unknown>[]} series={[{ key: "netCents", label: "Net", color: POS }, { key: "grossCents", label: "Gross", color: BRAND }, { key: "refundCents", label: "Refunds", color: NEG, kind: "line" }]} yFormat={usd} height={300} />;
    case "signups":
      return <BarsChart data={m.signups as unknown as Record<string, unknown>[]} xKey="label" barKey="signups" height={300} />;
    case "churn":
      return <DivergingBars data={m.churn} height={300} />;
    case "delivery":
      return <TrendChart data={m.delivery as unknown as Record<string, unknown>[]} series={[{ key: "delivered", label: "Delivered", color: POS }, { key: "failed", label: "Failed", color: NEG }]} height={300} />;
    case "arpu":
      return <p style={{ color: SLATE, padding: 20 }}>ARPU = MRR ÷ active subscribers ({usdFull(m.headline.mrrCents)} ÷ {m.headline.activeSubs} = {usdFull(m.headline.arpuCents)}). {compact(m.headline.activeSubs)} subs.</p>;
    default:
      return null;
  }
}
