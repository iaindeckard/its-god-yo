/**
 * Required add-ons for promo codes — the generic registry.
 *
 * Some promo codes are only valid when a specific add-on/wrapper is part of the
 * purchase (e.g. CHSPANTHERS15 only applies when "DM from Him" is included). This
 * is deliberately a GENERAL multi-select, not a DMFH-specific flag: a promo code
 * stores which add-on ids it requires (Stripe metadata `required_addons`, a CSV
 * of the ids below), and both the customer-facing validator and the authoritative
 * server-side gate loop this registry. Adding a future wrapper/add-on type
 * (denominational content, a season, etc.) is one entry here + (if it isn't
 * already) a field on AddonSelection — no rebuild of the Studio UI or the gate.
 *
 * Client-safe on purpose (no "server-only"): the signup flow imports the labels
 * to tell the customer which add-on a code needs, and the server imports the same
 * registry for the checkout gate, so the two can never drift.
 *
 * Mirrors the lib/tiers.ts pattern used by allowed_tiers.
 */

/**
 * The add-on selection state of one purchase, normalized so a registry predicate
 * can be evaluated identically on the client (from wizard state) and the server
 * (from pending_signups). Extend this as new required-able add-ons are added.
 */
export interface AddonSelection {
  /** DM from Him add-on selected (pending_signups.dm_addon / wizard dmEnabled). */
  dmAddon: boolean;
}

export interface RequiredAddonOption {
  /** Stable id stored in the promo code's `required_addons` metadata CSV. */
  id: string;
  /** Shown in the Studio selector and in the customer-facing "requires X" message. */
  label: string;
  /** Is this add-on present in the given selection? */
  isSelected: (sel: AddonSelection) => boolean;
}

/**
 * The single source of truth for add-ons a promo code can require. v1 ships with
 * DM from Him only; append entries for future wrappers/add-ons.
 */
export const REQUIRED_ADDON_OPTIONS: RequiredAddonOption[] = [
  {
    id: "dmfh",
    label: "DM from Him",
    isSelected: (sel) => sel.dmAddon === true,
  },
];

export const REQUIRED_ADDON_IDS: string[] = REQUIRED_ADDON_OPTIONS.map((o) => o.id);

/** Keep only ids that are real, known add-ons (drops stale/unknown metadata). */
export function parseRequiredAddons(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => REQUIRED_ADDON_IDS.includes(s));
}

/** Labels for a set of required add-on ids, in registry order (unknown ids dropped). */
export function requiredAddonLabels(ids: string[]): string[] {
  return REQUIRED_ADDON_OPTIONS.filter((o) => ids.includes(o.id)).map((o) => o.label);
}

/**
 * Given a code's required add-on ids and a purchase's selection, return the
 * options that are REQUIRED but NOT selected. Empty array => requirement met (or
 * the code has no required add-ons). This is the whole enforcement primitive,
 * shared by the validator and the server gate.
 */
export function unmetRequiredAddons(required: string[], sel: AddonSelection): RequiredAddonOption[] {
  if (!required.length) return [];
  return REQUIRED_ADDON_OPTIONS.filter((o) => required.includes(o.id) && !o.isSelected(sel));
}
