"use client";

import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import { CATEGORICAL, LINE, INK, SLATE } from "./theme";

export interface DonutDatum { key: string; label: string; value: number }

/**
 * Donut with a centered total and a compact legend. Optional slice click-to-drill.
 */
export default function DonutChart({
  data,
  height = 220,
  centerLabel,
  centerValue,
  valueFormat,
  onSliceClick,
}: {
  data: DonutDatum[];
  height?: number;
  centerLabel?: string;
  centerValue?: string;
  valueFormat?: (v: number) => string;
  onSliceClick?: (key: string) => void;
}) {
  const fmt = valueFormat ?? ((v: number) => `${v}`);
  const total = data.reduce((a, b) => a + b.value, 0);
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ position: "relative", width: height, height }}>
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="92%" paddingAngle={2} stroke="none"
              onClick={onSliceClick ? ((d: { payload?: DonutDatum }) => { const k = d?.payload?.key; if (k) onSliceClick(k); }) : undefined}>
              {data.map((d, i) => <Cell key={d.key} fill={CATEGORICAL[i % CATEGORICAL.length]} style={onSliceClick ? { cursor: "pointer" } : undefined} />)}
            </Pie>
            <Tooltip contentStyle={{ borderRadius: 10, border: `1px solid ${LINE}`, fontSize: 12 }} formatter={(v, _n, p: { payload?: DonutDatum }) => [fmt(Number(v)), p?.payload?.label ?? ""] as [string, string]} />
          </PieChart>
        </ResponsiveContainer>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: INK, lineHeight: 1 }}>{centerValue ?? total}</div>
          {centerLabel && <div style={{ fontSize: 11, color: SLATE, marginTop: 2 }}>{centerLabel}</div>}
        </div>
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, flex: "1 1 160px", minWidth: 150 }}>
        {data.map((d, i) => (
          <li key={d.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "3px 0" }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: CATEGORICAL[i % CATEGORICAL.length], flexShrink: 0 }} />
            <span style={{ color: INK, flex: 1 }}>{d.label}</span>
            <span style={{ color: SLATE }}>{total ? Math.round((d.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
