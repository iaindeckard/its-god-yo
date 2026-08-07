"use client";

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from "recharts";
import { GRID, LINE, SLATE, CATEGORICAL, BRAND } from "./theme";

/**
 * Horizontal or vertical bar chart. Optional per-bar colouring and click-to-drill.
 */
export default function BarsChart({
  data,
  xKey,
  barKey,
  height = 220,
  horizontal = false,
  colorful = false,
  valueFormat,
  onBarClick,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  barKey: string;
  height?: number;
  horizontal?: boolean;
  colorful?: boolean;
  valueFormat?: (v: number) => string;
  onBarClick?: (key: string) => void;
}) {
  const fmt = valueFormat ?? ((v: number) => `${v}`);
  const cell = (i: number) => (colorful ? CATEGORICAL[i % CATEGORICAL.length] : BRAND);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 6, right: 12, left: horizontal ? 8 : 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={horizontal} horizontal={!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" tick={{ fontSize: 11, fill: SLATE }} tickLine={false} axisLine={false} tickFormatter={fmt} />
            <YAxis type="category" dataKey={xKey} tick={{ fontSize: 11, fill: SLATE }} tickLine={false} axisLine={{ stroke: LINE }} width={130} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: SLATE }} tickLine={false} axisLine={{ stroke: LINE }} minTickGap={12} />
            <YAxis tick={{ fontSize: 11, fill: SLATE }} tickLine={false} axisLine={false} width={40} tickFormatter={fmt} />
          </>
        )}
        <Tooltip
          cursor={{ fill: "rgba(55,138,221,0.06)" }}
          contentStyle={{ borderRadius: 10, border: `1px solid ${LINE}`, fontSize: 12 }}
          formatter={(v) => [fmt(Number(v)), ""] as [string, string]}
        />
        <Bar dataKey={barKey} radius={horizontal ? [0, 6, 6, 0] : [6, 6, 0, 0]}
          onClick={onBarClick ? ((d: { payload?: Record<string, unknown> }) => { const v = d?.payload?.[xKey]; if (v != null) onBarClick(String(v)); }) : undefined}
          style={onBarClick ? { cursor: "pointer" } : undefined}>
          {data.map((_, i) => <Cell key={i} fill={cell(i)} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
