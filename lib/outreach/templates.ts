import "server-only";

/**
 * Approved outreach message variants (Phase 4a).
 *
 * GOVERNANCE: the actual email COPY lives in code (lib/outreach/email.ts) and
 * only changes through a reviewed commit. A campaign can NOT supply copy — it can
 * only select one of these approved variant KEYS (and set a discount NUMBER, which
 * templates into the single "{n}% off" numeral, never the surrounding words).
 * Anything not in this list resolves to 'default', so a bad/free-text value can
 * never inject unreviewed copy into a real send. Adding a new variant is a code +
 * copy/legal-approval task, not a runtime/DB change.
 *
 * Today there is exactly one approved variant: 'default' (the current locked copy).
 */
export const APPROVED_MESSAGE_VARIANTS = ["default"] as const;
export type MessageVariant = (typeof APPROVED_MESSAGE_VARIANTS)[number];

/** Human labels for the admin variant picker. */
export const MESSAGE_VARIANT_LABELS: Record<MessageVariant, string> = {
  default: "Default (approved)",
};

export function isApprovedVariant(v: unknown): v is MessageVariant {
  return typeof v === "string" && (APPROVED_MESSAGE_VARIANTS as readonly string[]).includes(v);
}

/** Coerce any stored/incoming value to an approved variant — unknown => 'default'. */
export function resolveVariant(v: unknown): MessageVariant {
  return isApprovedVariant(v) ? v : "default";
}

/**
 * Clamp a per-campaign discount to a valid Stripe percent (integer 1..100). This
 * is the ONLY campaign-configurable value that reaches the copy, and it reaches it
 * as a bare numeral substituted for "{n}" in "{n}% off" — no other text changes.
 */
export function clampDiscountPercent(pct: number | null | undefined): number {
  const n = Math.round(Number(pct));
  if (!Number.isFinite(n)) return 10;
  return Math.max(1, Math.min(100, n));
}
