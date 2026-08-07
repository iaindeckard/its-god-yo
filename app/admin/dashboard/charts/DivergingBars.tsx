"use client";

import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Legend,
} from "recharts";
import { GRID, LINE, SLATE, POS, NEG, INK } from "./theme";

/**
 * Churn view: added subscribers (up, green) vs churned (down, red) as diverging
 * bars around a zero line, with the net-change line overlaid. Answers "are we net
 * growing week over week" at a glance.
 */
export default function DivergingBars({
  data,
  height = 240,
}: {
  data: { label: string; added: number; churned: number; net: number }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }} stackOffset="sign">
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: SLATE }} tickLine={false} axisLine={{ stroke: LINE }} minTickGap={16} />
        <YAxis tick={{ fontSize: 11, fill: SLATE }} tickLine={false} axisLine={false} width={34} />
        <Tooltip contentStyle={{ borderRadius: 10, border: `1px solid ${LINE}`, fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
        <ReferenceLine y={0} stroke={LINE} />
        <Bar dataKey="added" name="Added" fill={POS} radius={[4, 4, 0, 0]} stackId="s" />
        <Bar dataKey="churned" name="Churned" fill={NEG} radius={[0, 0, 4, 4]} stackId="s" />
        <Line dataKey="net" name="Net change" type="monotone" stroke={INK} strokeWidth={2} dot={{ r: 2.5 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
