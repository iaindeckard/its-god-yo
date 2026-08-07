"use client";

import { useState } from "react";
import { rampColor, NEG, SLATE, INK, LINE } from "./theme";

export interface HeatCell { day: number; hour: number; total: number; failed: number }

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Delivery heatmap — weekday x hour grid. Cell shade = send volume (sequential
 * ramp); a red corner flag marks cells with any failed sends. Surfaces WHEN sends
 * cluster and WHERE failures concentrate far better than a daily line.
 */
export default function Heatmap({ cells, hourStart = 6, hourEnd = 21 }: { cells: HeatCell[]; hourStart?: number; hourEnd?: number }) {
  const [hover, setHover] = useState<HeatCell | null>(null);
  const byKey = new Map(cells.map((c) => [`${c.day}-${c.hour}`, c]));
  const max = Math.max(1, ...cells.map((c) => c.total));
  const hours = Array.from({ length: hourEnd - hourStart + 1 }, (_, i) => hourStart + i);
  const cell = 20, gap = 3, labelW = 34, labelH = 16;
  const gridW = hours.length * (cell + gap);
  const fmtHour = (h: number) => (h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`);

  return (
    <div style={{ position: "relative", overflowX: "auto" }}>
      <svg width={labelW + gridW} height={labelH + 7 * (cell + gap)} role="img" aria-label="Delivery heatmap by weekday and hour">
        {hours.map((h, i) => (
          (h % 3 === 0) && <text key={h} x={labelW + i * (cell + gap)} y={labelH - 4} fontSize={9} fill={SLATE}>{fmtHour(h)}</text>
        ))}
        {DAYS.map((d, day) => (
          <text key={d} x={0} y={labelH + day * (cell + gap) + cell / 2 + 3} fontSize={10} fill={SLATE}>{d}</text>
        ))}
        {DAYS.map((_, day) =>
          hours.map((h, i) => {
            const c = byKey.get(`${day}-${h}`);
            const t = c ? c.total / max : 0;
            const x = labelW + i * (cell + gap);
            const y = labelH + day * (cell + gap);
            return (
              <g key={`${day}-${h}`} onMouseEnter={() => c && setHover(c)} onMouseLeave={() => setHover(null)}>
                <rect x={x} y={y} width={cell} height={cell} rx={3} fill={c ? rampColor(t) : "#f6f8fb"} stroke={c && hover === c ? INK : "transparent"} strokeWidth={1} />
                {c && c.failed > 0 && <path d={`M${x + cell - 6},${y} L${x + cell},${y} L${x + cell},${y + 6} Z`} fill={NEG} />}
              </g>
            );
          }),
        )}
      </svg>
      {hover && (
        <div style={{ marginTop: 6, fontSize: 12, color: SLATE, borderTop: `1px dashed ${LINE}`, paddingTop: 6 }}>
          <strong style={{ color: INK }}>{DAYS[hover.day]} {fmtHour(hover.hour)}</strong> · {hover.total} sends
          {hover.failed > 0 && <span style={{ color: NEG }}> · {hover.failed} failed</span>}
        </div>
      )}
    </div>
  );
}
