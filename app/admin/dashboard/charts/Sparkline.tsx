"use client";

import { BRAND, POS, NEG } from "./theme";

/**
 * Hand-rolled SVG sparkline — zero-dependency, brand-controlled, tiny. Used on the
 * at-a-glance cards where a full chart would be overkill; the card can expand into
 * a full Recharts panel on click (progressive disclosure).
 */
export default function Sparkline({
  data,
  width = 120,
  height = 34,
  color = BRAND,
  fill = true,
  tone,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
  tone?: "auto";
}) {
  const pts = data.length ? data : [0, 0];
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const pad = 3;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const stepX = pts.length > 1 ? w / (pts.length - 1) : 0;
  const x = (i: number) => pad + i * stepX;
  const y = (v: number) => pad + h - ((v - min) / span) * h;

  const line = pts.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${(pad + h).toFixed(1)} L${x(0).toFixed(1)},${(pad + h).toFixed(1)} Z`;

  const stroke = tone === "auto" ? (pts[pts.length - 1] >= pts[0] ? POS : NEG) : color;
  const gid = `sg-${stroke.replace("#", "")}-${width}-${height}`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-hidden="true" style={{ display: "block" }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity={0.22} />
          <stop offset="100%" stopColor={stroke} stopOpacity={0} />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#${gid})`} />}
      <path d={line} fill="none" stroke={stroke} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1])} r={2.2} fill={stroke} />
    </svg>
  );
}
