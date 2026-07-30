/**
 * Canonical rejection-reason taxonomy for the content review workflow.
 *
 * Single source of truth shared by the review UIs (dropdown options) and the
 * API routes (server-side validation) so the two can never drift. Built from
 * the 2026-07-30 review session's actual failure modes, split by the two
 * reject actions (they are different failure modes):
 *   - reject_verse       -> the KJV pick was wrong (verse-selection reasons)
 *   - reject_translation -> the slang reword was wrong (translation reasons)
 * "Other" is always available for either action and REQUIRES a free-text note.
 *
 * Stored in corrections_log.category as the stable snake_case KEY (queryable —
 * "what gets rejected most, and why"); the human label is display-only and can
 * be relabeled later without breaking history. corrections_log.reason holds the
 * human-readable text: the label for a preset category, or the reviewer's free
 * text when the category is "other".
 */

export const OTHER_KEY = "other" as const;

export interface RejectionReason {
  key: string;
  label: string;
}

/** Verse-selection reasons — action_type = reject_verse. */
export const VERSE_SELECTION_REASONS: readonly RejectionReason[] = [
  { key: "too_short", label: "Too short / thin" },
  { key: "no_context", label: "Confusing without context" },
  { key: "not_general", label: "Doesn't generalize (person/place/nation-specific)" },
  { key: "third_person", label: "Third-person narration" },
  { key: "dark_tone", label: "Heavy/dark tone" },
  { key: "confusing_phrase", label: "Confusing word/phrase" },
  { key: "theologically_dense", label: "Theologically dense" },
  { key: "audience_mismatch", label: "Audience mismatch" },
  { key: "offensive_risk", label: "Misread/offensive risk" },
  { key: "duplicate", label: "Duplicate" },
] as const;

/** Translation/reword reasons — action_type = reject_translation. */
export const TRANSLATION_REASONS: readonly RejectionReason[] = [
  { key: "meaning_drift", label: "Meaning drift" },
  { key: "tone_wrong", label: "Tone wrong" },
] as const;

const OTHER_REASON: RejectionReason = { key: OTHER_KEY, label: "Other" };

/** Dropdown options for a given reject mode, always ending with "Other". */
export function reasonsFor(mode: "verse" | "translation"): readonly RejectionReason[] {
  const base = mode === "verse" ? VERSE_SELECTION_REASONS : TRANSLATION_REASONS;
  return [...base, OTHER_REASON];
}

/** Label for a stored category key (falls back to the key if unknown). */
export function labelForCategory(key: string | null | undefined): string | null {
  if (!key) return null;
  const all = [...VERSE_SELECTION_REASONS, ...TRANSLATION_REASONS, OTHER_REASON];
  return all.find((r) => r.key === key)?.label ?? key;
}

/** True iff `category` is a legal key for `mode` (or "other"). */
export function isValidCategory(mode: "verse" | "translation", category: string): boolean {
  return reasonsFor(mode).some((r) => r.key === category);
}

/** Every category key that can be persisted (for the DB CHECK constraint / audits). */
export const ALL_CATEGORY_KEYS: readonly string[] = [
  ...VERSE_SELECTION_REASONS.map((r) => r.key),
  ...TRANSLATION_REASONS.map((r) => r.key),
  OTHER_KEY,
];
