import "server-only";
import { getCurrentStaff } from "./rbac";

/**
 * Server-side proxy to the EXISTING review Edge Functions. We do NOT reimplement
 * their logic — approve/reject/session behavior lives entirely in the deployed
 * functions. The admin API routes call these after enforcing content.queue.*
 * permissions, and inject the acting reviewer_id (so the functions don't have to
 * trust a client-supplied id).
 */
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://bkwtlfkhfbfyzgnozixw.supabase.co";
const ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJrd3RsZmtoZmJmeXpnbm96aXh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0ODc3NzMsImV4cCI6MjEwMDA2Mzc3M30.2d_GCThTXnL9wAVWjdqd_Agibl5etQy5NDoieyrEP1Q";

/** Stable fallback reviewer id for the deferred-login phase — no FK constraint
 *  on approved_by/corrected_by, so any UUID is fine; a fixed one keeps
 *  attribution consistent until real staff ids exist. */
const DEV_REVIEWER_ID = "00000000-0000-0000-0000-000000000001";

export async function reviewerId(): Promise<string> {
  const staff = await getCurrentStaff();
  return staff?.userId || DEV_REVIEWER_ID;
}

export async function invokeReviewFn(name: string, payload: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON, Authorization: `Bearer ${ANON}` },
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
