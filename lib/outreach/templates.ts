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
 * Approved variants:
 *   'default'         — the locked church/youth-ministry copy (two-touch, per-lead code)
 *   'catholic_school' — the national Catholic K-12 Schools campaign (single email
 *                       carrying the shared APPRECIATION10 code + DMFH upsell)
 */
export const APPROVED_MESSAGE_VARIANTS = ["default", "catholic_school"] as const;
export type MessageVariant = (typeof APPROVED_MESSAGE_VARIANTS)[number];

/** Human labels for the admin variant picker. */
export const MESSAGE_VARIANT_LABELS: Record<MessageVariant, string> = {
  default: "Default (approved)",
  catholic_school: "Catholic School (approved)",
};

/**
 * Per-variant send SHAPE. Copy still lives in email.ts; this governs the mechanics
 * that differ between variants and must not be a runtime/DB value:
 *   - singleTouch: send exactly one email (no 30-day follow-up). The Catholic
 *     Schools email already carries the code up front, so there is no second touch.
 *   - sharedPromoCode: a fixed, pre-created promotion code shared across every lead
 *     in the campaign (vs the default's unique per-lead minted code). A shared code
 *     is deliberately NOT persisted as promo_promotion_code_id on the lead, because
 *     the conversion webhook matches that id and would otherwise mark EVERY lead
 *     converted on a single redemption. Per-lead attribution for a shared-code
 *     campaign rides the signed outreach entry URL instead.
 */
export interface VariantProfile {
  singleTouch: boolean;
  sharedPromoCode: string | null;
}

export const VARIANT_PROFILE: Record<MessageVariant, VariantProfile> = {
  default: { singleTouch: false, sharedPromoCode: null },
  // APPRECIATION10 is a public promo code (it appears in the email), created by
  // Iain in the Promo Code Studio: 10% off, expires 2026-12-31, no DMFH attach
  // requirement, checkout attestation. It is hard-coded here (not env/DB) so the
  // offer wiring is reviewed alongside the copy, matching this file's governance.
  catholic_school: { singleTouch: true, sharedPromoCode: "APPRECIATION10" },
};

export function variantProfile(v: unknown): VariantProfile {
  return VARIANT_PROFILE[resolveVariant(v)];
}

/** True when the resolved variant is the Catholic K-12 Schools variant. */
export function isSchoolVariant(v: unknown): boolean {
  return resolveVariant(v) === "catholic_school";
}

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
