/**
 * Shared chart theme — one palette + formatters so every widget on the KPI
 * dashboard reads as a single system. Anchored on the IGY brand blue (#378ADD),
 * extended with distinct, colour-blind-mindful hues for categorical series, plus
 * semantic colours (green = good/delivered, red = failed/churn) and a sequential
 * ramp for the delivery heatmap. Mirrors the dataviz palette method.
 */

export const INK = "#14213d";
export const SLATE = "#5b6b85";
export const LINE = "#e2e8f0";
export const GRID = "#eef2f8";

export const BRAND = "#378ADD"; // IGY blue
export const BRAND_DARK = "#1f5fa8";

// Categorical palette (max ~6 series). Ordered for maximum adjacent contrast.
export const CATEGORICAL = [
  "#378ADD", // blue
  "#00ABBC", // teal
  "#F4A623", // gold
  "#5B8A3C", // green
  "#E4572E", // coral
  "#7B54C4", // purple
];

// Semantic
export const POS = "#2E9E5B"; // delivered / added / good
export const NEG = "#D64545"; // failed / churned / refund
export const WARN = "#E8912D";

// Sequential ramp (light -> brand) for the heatmap.
export const RAMP = ["#eef4fb", "#cfe1f6", "#a9caee", "#7db0e4", "#4f93da", "#2f78c4", "#1f5fa8"];

export function usd(cents: number): string {
  const d = cents / 100;
  if (Math.abs(d) >= 1000) return `$${(d / 1000).toFixed(d % 1000 === 0 ? 0 : 1)}k`;
  return `$${d.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
export function usdFull(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
export function pct(v: number | null, digits = 1): string {
  return v == null ? "—" : `${v.toFixed(digits)}%`;
}
export function compact(n: number): string {
  return Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}
export function rampColor(t: number): string {
  const i = Math.max(0, Math.min(RAMP.length - 1, Math.round(t * (RAMP.length - 1))));
  return RAMP[i];
}
