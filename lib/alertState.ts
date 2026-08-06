import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Thin wrapper over the claim_alert / resolve_alert Postgres functions
 * (migration 20260806120000_alert_state). Shared by Tier 2 (email, dedup per
 * episode) and Tier 3 (SMS, 4h cooldown per alert-type + affected-entity, reset
 * on resolution). Keeping the fire-decision in the DB makes it race-safe: two
 * concurrent callers can never both "win" a claim.
 */

/** 4 hours, per the Tier 3 cooldown addendum (LOCKED 2026-08-06). */
export const SMS_COOLDOWN_MS = 4 * 60 * 60 * 1000;

/**
 * Atomically claim an alert. Returns true iff the caller should actually send.
 * cooldownMs = null → fire once per episode and stay silent until resolveAlert()
 * (Tier 2). cooldownMs = N → also re-fire once N ms have elapsed while the issue
 * is still unresolved, as a "still broken" reminder (Tier 3).
 */
export async function claimAlert(
  db: SupabaseClient,
  args: { alertType: string; entityKey?: string; cooldownMs: number | null; message?: string },
): Promise<boolean> {
  const { data, error } = await db.rpc("claim_alert", {
    p_type: args.alertType,
    p_key: args.entityKey ?? "",
    p_cooldown_ms: args.cooldownMs,
    p_message: args.message ?? null,
  });
  if (error) throw new Error(`claim_alert_failed: ${error.message}`);
  return data === true;
}

/**
 * Mark an alert resolved so the next occurrence fires immediately instead of
 * waiting out a stale cooldown. Returns true if a row actually transitioned
 * unresolved → resolved (useful for logging "issue cleared"). Best-effort by
 * convention at call sites — a resolution that fails to record only costs one
 * extra suppressed/duplicate alert, never a missed real one.
 */
export async function resolveAlert(
  db: SupabaseClient,
  args: { alertType: string; entityKey?: string },
): Promise<boolean> {
  const { data, error } = await db.rpc("resolve_alert", {
    p_type: args.alertType,
    p_key: args.entityKey ?? "",
  });
  if (error) throw new Error(`resolve_alert_failed: ${error.message}`);
  return data === true;
}
