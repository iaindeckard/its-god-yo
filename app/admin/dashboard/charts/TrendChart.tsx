"use client";

import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { GRID, LINE, SLATE, CATEGORICAL } from "./theme";

export interface Series {
  key: string;
  label: string;
  color?: string;
  kind?: "area" | "line";
  dashed?: boolean;
}

/**
 * Reusable trend chart (area and/or line, multi-series) with a brand tooltip and
 * an optional drill-down: clicking the plot calls onPointClick with the bucket's
 * x-value so the parent can reveal that period's breakdown.
 */
export default function TrendChart({
  data,
  series,
  height = 240,
  yFormat,
  onPointClick,
  legend = true,
}: {
  data: Record<string, unknown>[];
  series: Series[];
  height?: number;
  yFormat?: (v: number) => string;
  onPointClick?: (xValue: string) => void;
  legend?: boolean;
}) {
  const allArea = series.every((s) => (s.kind ?? "area") === "area");
  const fmt = yFormat ?? ((v: number) => `${v}`);

  const tooltip = (
    <Tooltip
      cursor={{ stroke: LINE, strokeWidth: 1 }}
      contentStyle={{ borderRadius: 10, border: `1px solid ${LINE}`, fontSize: 12, boxShadow: "0 6px 20px rgba(20,33,61,0.10)" }}
      labelStyle={{ color: SLATE, fontWeight: 700, marginBottom: 4 }}
      formatter={(v, name) => [fmt(Number(v)), name] as [string, string]}
    />
  );
  const axes = (
    <>
      <CartesianGrid stroke={GRID} vertical={false} />
      <XAxis dataKey="label" tick={{ fontSize: 11, fill: SLATE }} tickLine={false} axisLine={{ stroke: LINE }} minTickGap={16} />
      <YAxis tick={{ fontSize: 11, fill: SLATE }} tickLine={false} axisLine={false} width={44} tickFormatter={fmt} />
      {tooltip}
      {legend && series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} iconType="plainline" />}
    </>
  );

  const clickProps = onPointClick
    ? { onClick: (e: { activeLabel?: string | number }) => { if (e?.activeLabel != null) onPointClick(String(e.activeLabel)); }, style: { cursor: "pointer" as const } }
    : {};

  return (
    <ResponsiveContainer width="100%" height={height}>
      {allArea ? (
        <AreaChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }} {...clickProps}>
          <defs>
            {series.map((s, i) => {
              const c = s.color ?? CATEGORICAL[i % CATEGORICAL.length];
              return (
                <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={c} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={c} stopOpacity={0.02} />
                </linearGradient>
              );
            })}
          </defs>
          {axes}
          {series.map((s, i) => {
            const c = s.color ?? CATEGORICAL[i % CATEGORICAL.length];
            return (
              <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={c} strokeWidth={2}
                fill={`url(#grad-${s.key})`} activeDot={{ r: 4 }} dot={false} strokeDasharray={s.dashed ? "5 4" : undefined} />
            );
          })}
        </AreaChart>
      ) : (
        <LineChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }} {...clickProps}>
          {axes}
          {series.map((s, i) => {
            const c = s.color ?? CATEGORICAL[i % CATEGORICAL.length];
            return (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={c} strokeWidth={2.25}
                dot={false} activeDot={{ r: 4 }} strokeDasharray={s.dashed ? "5 4" : undefined} />
            );
          })}
        </LineChart>
      )}
    </ResponsiveContainer>
  );
}
