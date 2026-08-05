import "server-only";
import { getSupabaseAdmin } from "./supabaseAdmin";

/**
 * Church roster tracker — Phase 2 (names-only progress display).
 *
 * A minister optionally pastes a plain list of teen FIRST NAMES so their dashboard
 * can show "X of N on your list have joined." This module reads the match status
 * (computed on-read against the names teens enter in their own self-signup) and
 * replaces the saved list. It NEVER stores contact info, sends anything, or
 * enrolls anyone — matching a name only flips a display flag.
 */

// Guardrail: a roster is a youth-group list, not a mailing list. Cap the count so
// a paste can't balloon the table, and cap each name's length.
export const ROSTER_MAX_NAMES = 2000;
const NAME_MAX_LEN = 80;

export interface RosterName {
  firstName: string;
  matched: boolean; // a teen with this first name self-enrolled through the church link
  joined: boolean;  // ...and their subscription exists (past the confirm step)
}

export interface RosterStatus {
  total: number;
  joined: number;     // roster names matched to a joined signup
  invited: number;    // matched, but only to a not-yet-confirmed signup
  notYet: number;     // no matching signup at all
  names: RosterName[];
}

/** Read the minister's roster with live match status (empty roster => zeros). */
export async function getRosterStatus(partnerId: string): Promise<RosterStatus> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("v_church_roster_status")
    .select("first_name, matched, joined")
    .eq("cornerstone_partner_id", partnerId)
    .order("first_name", { ascending: true });
  if (error) throw new Error(`roster_status_failed: ${error.message}`);
  const names: RosterName[] = (data ?? []).map((r) => ({
    firstName: r.first_name, matched: !!r.matched, joined: !!r.joined,
  }));
  return {
    total: names.length,
    joined: names.filter((n) => n.joined).length,
    invited: names.filter((n) => n.matched && !n.joined).length,
    notYet: names.filter((n) => !n.matched).length,
    names,
  };
}

/** Parse a pasted blob (newlines/commas) into clean, de-duped display names. */
export function parseRosterInput(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of (raw || "").split(/[\n,]+/)) {
    const name = piece.trim().replace(/\s+/g, " ").slice(0, NAME_MAX_LEN);
    if (!name) continue;
    // De-dupe on the same normalized key the DB uses (lowercase, alnum-only).
    const key = name.toLowerCase().replace(/[^a-z0-9]/gi, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.slice(0, ROSTER_MAX_NAMES);
}

/**
 * Replace the partner's saved roster with `names` (authoritative list semantics:
 * what the minister sees in the box is what's stored). Compute-on-read matching
 * means nothing is lost by replacing — match state is always recomputed.
 */
export async function saveRoster(
  partnerId: string,
  names: string[],
  createdBy?: string | null,
): Promise<RosterStatus> {
  const admin = getSupabaseAdmin();
  const clean = parseRosterInput(names.join("\n"));

  const { error: delErr } = await admin
    .from("church_roster_names").delete().eq("cornerstone_partner_id", partnerId);
  if (delErr) throw new Error(`roster_clear_failed: ${delErr.message}`);

  if (clean.length) {
    const rows = clean.map((first_name) => ({
      cornerstone_partner_id: partnerId, first_name, created_by: createdBy ?? null,
    }));
    const { error: insErr } = await admin.from("church_roster_names").insert(rows);
    if (insErr) throw new Error(`roster_save_failed: ${insErr.message}`);
  }
  return getRosterStatus(partnerId);
}
