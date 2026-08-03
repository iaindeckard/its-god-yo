/**
 * Salutation / honorific title support, tied to language preference.
 *
 * Titles are a STRUCTURED multi-select stored as an array (text[]) — people can
 * combine titles (e.g. ["Rev.", "Dr."] → "Rev. Dr."). An "Other" free-text entry
 * is simply another string element in the same array, so no separate column is
 * needed.
 *
 * DISPLAY/ORDERING: the option list is presented sorted by the person's existing
 * language preference (en/es) — Spanish-preference sees Spanish terms first,
 * English-preference sees English first — but the FULL combined list is always
 * available to everyone; nobody is restricted to one language's terms.
 *
 * This is the ONE place name+salutation rendering lives (`formatPersonName`);
 * reuse it everywhere a person's name shows (emails, admin views, future
 * documents) rather than re-joining name fields ad hoc.
 */

export type Lang = "en" | "es";

// English / general honorifics.
export const SALUTATIONS_EN = [
  "Mr.", "Mrs.", "Ms.", "Mx.", "Dr.", "Rev.", "Fr.", "Pastor", "Deacon", "Bishop", "Sister", "Br.",
] as const;

// Spanish honorifics.
export const SALUTATIONS_ES = [
  "Sr.", "Sra.", "Srta.", "Dra.", "Padre", "Don", "Doña", "Pastora", "Reverendo", "Reverenda",
  "Diácono", "Diaconisa", "Obispo", "Hermano", "Hermana",
] as const;

/**
 * The full combined title list, ordered by language preference: the preferred
 * language's terms first, then the other language's. Everyone gets ALL terms.
 * The UI should render these as the multi-select options and offer a separate
 * "Other" free-text input for anything not listed.
 */
export function salutationOptions(lang: Lang): string[] {
  return lang === "es"
    ? [...SALUTATIONS_ES, ...SALUTATIONS_EN]
    : [...SALUTATIONS_EN, ...SALUTATIONS_ES];
}

/** True when `t` is one of the known canonical titles (either language). */
export function isKnownSalutation(t: string): boolean {
  const v = t.trim();
  return (SALUTATIONS_EN as readonly string[]).includes(v) || (SALUTATIONS_ES as readonly string[]).includes(v);
}

/**
 * Normalize a raw salutation selection for storage: trims, drops empties, and
 * de-dupes while PRESERVING the order the user selected them (we intentionally do
 * not impose a canonical cross-language ordering for v1). Returns null when empty
 * so the column stays NULL rather than an empty array.
 */
export function normalizeSalutation(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const v = item.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out.length ? out : null;
}

/**
 * Render a person's display name: selected titles (in selection order) followed
 * by the name. Accepts EITHER a single `name` field (e.g. Cornerstone
 * `contact_name`) OR `firstName`/`lastName` (e.g. the purchaser). Falls back to
 * whatever is present; returns "" if nothing is set.
 *
 * e.g. { salutation: ["Rev.","Dr."], firstName: "Jane", lastName: "Doe" }
 *        → "Rev. Dr. Jane Doe"
 */
export function formatPersonName(input: {
  salutation?: string[] | null;
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
}): string {
  const titles = (input.salutation ?? []).map((s) => (s ?? "").trim()).filter(Boolean);
  const nameParts = (input.name ?? "").trim()
    ? [(input.name as string).trim()]
    : [input.firstName, input.lastName].map((s) => (s ?? "").trim()).filter(Boolean);
  return [...titles, ...nameParts].join(" ").trim();
}
