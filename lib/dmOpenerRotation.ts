import "server-only";
import { getSupabaseAdmin } from "./supabaseAdmin";
import { DM_OPENERS } from "./dmOpeners";

/**
 * Per-subscriber shuffle-then-cycle rotation for the DM-from-Him opener. Each
 * subscriber (consent_log id) gets a random permutation of the pool; we walk it
 * one line per send and reshuffle only after the whole pool is used, so no line
 * repeats until all 130 have. With a 130-line pool sent daily that's ~2.8x/year
 * max, structurally (not probabilistically) guaranteed.
 *
 * Split into peek (choose, don't advance) + advance (after a confirmed send) so a
 * failed/undelivered send or the fit-guard dropping the opener never burns a slot.
 * The daily_send_log unique claim serializes callers per (recipient, date), so the
 * read-modify-write here needs no extra locking.
 */

function shuffledIndices(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * The opener index this subscriber should get next, WITHOUT advancing. Creates
 * the rotation row (fresh shuffle) on first use, and self-heals if the stored
 * permutation is empty or points past the current pool size.
 */
export async function peekOpenerIndex(consentId: string): Promise<number> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("dm_opener_rotation")
    .select("shuffled, cursor")
    .eq("consent_id", consentId)
    .maybeSingle();
  const shuffled = data?.shuffled as number[] | undefined;
  const cursor = data?.cursor as number | undefined;
  if (shuffled && shuffled.length && cursor != null && cursor < shuffled.length && shuffled[cursor] < DM_OPENERS.length) {
    return shuffled[cursor];
  }
  const fresh = shuffledIndices(DM_OPENERS.length);
  await admin.from("dm_opener_rotation").upsert(
    { consent_id: consentId, shuffled: fresh, cursor: 0, cycle: 1, updated_at: new Date().toISOString() },
    { onConflict: "consent_id" },
  );
  return fresh[0];
}

/**
 * Advance the cursor after an opener was actually sent. Reshuffles + bumps cycle
 * when the pool is exhausted. Only call on a confirmed send that included an opener.
 */
export async function advanceOpener(consentId: string): Promise<void> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("dm_opener_rotation")
    .select("shuffled, cursor, cycle")
    .eq("consent_id", consentId)
    .maybeSingle();
  if (!data) return; // peek creates the row; defensive
  let shuffled = data.shuffled as number[];
  let cursor = (data.cursor as number) + 1;
  let cycle = data.cycle as number;
  if (cursor >= shuffled.length) {
    shuffled = shuffledIndices(DM_OPENERS.length);
    cursor = 0;
    cycle += 1;
  }
  await admin
    .from("dm_opener_rotation")
    .update({ shuffled, cursor, cycle, updated_at: new Date().toISOString() })
    .eq("consent_id", consentId);
}
