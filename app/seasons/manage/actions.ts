"use server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { SEASONS_ENABLED } from "@/lib/flags";
import { verifySeasonManageToken } from "@/lib/seasons/token";
import { setSeasonEnrollment } from "@/lib/seasons/enrollment";
import type { SeasonKey } from "@/lib/seasons/liturgical";

/** Whole-family enroll/toggle from the tokenized manage page. Re-verifies the token
 *  server-side so the action can't be called for another customer. */
export async function toggleSeasonAction(input: {
  customerId: string;
  token: string;
  seasonKey: SeasonKey;
  active: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  // Fail closed while seasons are dark: the enrollment/toggle path is gated by the
  // flag, not only the billing/send crons (matches lib/flags.ts SEASONS_ENABLED).
  if (!SEASONS_ENABLED) return { ok: false, error: "seasons_disabled" };
  if (!verifySeasonManageToken(input.customerId, input.token)) return { ok: false, error: "unauthorized" };
  await setSeasonEnrollment(getSupabaseAdmin(), {
    customerId: input.customerId,
    seasonKey: input.seasonKey,
    active: input.active,
    // On enroll, auto-renew defaults on; payment method is left null so the pre-season
    // charge falls back to the customer's default card (set at signup).
    autoRenew: input.active ? true : undefined,
  });
  return { ok: true };
}
