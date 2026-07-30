import "server-only";
import { createClient } from "./supabase/server";

/**
 * Server-side proxy to the deployed review Edge Functions. Each admin API route
 * enforces its content.queue.* permission before calling here; in addition, the
 * Edge Functions THEMSELVES now verify the caller's JWT and re-check the
 * permission via has_permission() (defense-in-depth — they are publicly
 * reachable, so they can't trust the caller). We forward the signed-in staff
 * member's session access token as the Authorization bearer; the acting
 * reviewer_id is derived from that verified token inside each function, so it is
 * no longer sent from here (a client/caller can't spoof attribution).
 */
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://bkwtlfkhfbfyzgnozixw.supabase.co";
const ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJrd3RsZmtoZmJmeXpnbm96aXh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0ODc3NzMsImV4cCI6MjEwMDA2Mzc3M30.2d_GCThTXnL9wAVWjdqd_Agibl5etQy5NDoieyrEP1Q";

export async function invokeReviewFn(name: string, payload: Record<string, unknown>): Promise<unknown> {
  // Forward the signed-in staff member's access token; the Edge Function
  // validates it (auth.getUser) and enforces has_permission. The route already
  // gated the caller via requirePermission, so a missing session here is an
  // internal error, but guard rather than fall back to the anon key.
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) {
    const err = new Error(`${name} failed: no authenticated session`);
    (err as { status?: number }).status = 401;
    throw err;
  }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON, Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data as { error?: string })?.error || `${name} failed (${res.status})`);
    (err as { status?: number }).status = res.status;
    throw err;
  }
  return data;
}
