import "server-only";
import { getSupabaseAdmin } from "./supabaseAdmin";

export type SampleVerse = { text: string; verseRef: string | null };

/**
 * Pull a fresh spread of already-approved, already-live daily-verse paraphrases for
 * the public no-signup sample surfaces (the /sample page + the homepage teaser).
 *
 * Source of truth is the SAME content the daily send uses: daily_slots rows with
 * status='approved' and a non-empty English paraphrase (final_translation). No new
 * content is generated here and nothing unreviewed is ever shown. The approved pool
 * is small (a couple hundred short rows), so we pull it whole, shuffle, then
 * round-robin across theme_track so the returned set shows a spread of tone/range
 * rather than a run of one track. Reshuffles on every call (these surfaces are
 * dynamic / no-store), so a reload feels alive. Purely presentational: reads two
 * safe columns, touches no billing / SMS / PII.
 */
export async function getSampleVerses(n = 6): Promise<SampleVerse[]> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("daily_slots")
    .select("final_translation, verse_ref, theme_track")
    .eq("status", "approved")
    .not("final_translation", "is", null);
  if (error || !data) return [];

  // Bucket by track, shuffle each bucket.
  const byTrack = new Map<string, SampleVerse[]>();
  for (const row of data as { final_translation: string | null; verse_ref: string | null; theme_track: string | null }[]) {
    const text = (row.final_translation ?? "").trim();
    if (!text) continue;
    const track = row.theme_track ?? "general";
    if (!byTrack.has(track)) byTrack.set(track, []);
    byTrack.get(track)!.push({ text, verseRef: row.verse_ref ?? null });
  }
  for (const bucket of byTrack.values()) shuffle(bucket);

  // Round-robin across the (shuffled) tracks to diversify tone across the result.
  const tracks = shuffle([...byTrack.keys()]);
  const out: SampleVerse[] = [];
  let added = true;
  while (out.length < n && added) {
    added = false;
    for (const t of tracks) {
      const next = byTrack.get(t)!.pop();
      if (next) {
        out.push(next);
        added = true;
        if (out.length >= n) break;
      }
    }
  }
  return out;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
