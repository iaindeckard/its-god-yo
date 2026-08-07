"use client";

import { CATEGORICAL, INK, SLATE } from "./theme";

export interface FunnelStage { key: string; label: string; count: number }

/**
 * Hand-rolled SVG funnel: centered trapezoid stages that narrow with drop-off,
 * each annotated with its count, % of top, and step conversion vs the prior stage.
 * Communicates signup -> active drop-off far better than a bar row.
 */
export default function FunnelChart({ stages, height = 250 }: { stages: FunnelStage[]; height?: number }) {
  const top = stages[0]?.count || 1;
  const max = Math.max(...stages.map((s) => s.count), 1);
  const W = 460;
  const rowH = height / stages.length;
  const widthFor = (c: number) => Math.max(30, (c / max) * (W - 40));

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Signup to active funnel">
      {stages.map((s, i) => {
        const y = i * rowH;
        const wTop = widthFor(s.count);
        const wBot = widthFor(stages[i + 1]?.count ?? s.count);
        const cx = W / 2;
        const pad = 8;
        const x1 = cx - wTop / 2, x2 = cx + wTop / 2;
        const x3 = cx + wBot / 2, x4 = cx - wBot / 2;
        const color = CATEGORICAL[i % CATEGORICAL.length];
        const pctTop = Math.round((s.count / top) * 100);
        const stepPct = i === 0 ? null : Math.round((s.count / (stages[i - 1].count || 1)) * 100);
        return (
          <g key={s.key}>
            <path d={`M${x1},${y + pad} L${x2},${y + pad} L${x3},${y + rowH - pad} L${x4},${y + rowH - pad} Z`} fill={color} fillOpacity={0.9} />
            <text x={cx} y={y + rowH / 2 - 2} textAnchor="middle" fontSize={13} fontWeight={700} fill="#fff">{s.count.toLocaleString()}</text>
            <text x={cx} y={y + rowH / 2 + 14} textAnchor="middle" fontSize={10} fill="#fff" fillOpacity={0.9}>{s.label}</text>
            <text x={W - 4} y={y + rowH / 2 - 2} textAnchor="end" fontSize={11} fontWeight={700} fill={INK}>{pctTop}%</text>
            {stepPct != null && <text x={W - 4} y={y + rowH / 2 + 12} textAnchor="end" fontSize={10} fill={SLATE}>{stepPct}% of prior</text>}
          </g>
        );
      })}
    </svg>
  );
}
