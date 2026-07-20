import "server-only";
import { getSupabaseAdmin } from "./supabaseAdmin";

/**
 * Node/Next mirror of the age-consent gate. The AUTHORITATIVE enforcement lives
 * in the submit-consent Edge Function (the single non-bypassable write path);
 * this is used only to PREVIEW the decision in the signup UI so the right
 * message/branch shows before submit. Both read the same age_consent_thresholds
 * table and share the same fail-safe rules — keep them in sync.
 */
export const FAILSAFE_MIN_AGE = 16;

const CALLING_CODE_TO_ISO: Record<string, string> = {
  "1": "US", "52": "MX",
  "44": "GB", "353": "IE", "49": "DE", "33": "FR", "34": "ES", "39": "IT", "351": "PT",
  "31": "NL", "32": "BE", "41": "CH", "43": "AT", "46": "SE", "45": "DK", "47": "NO",
  "358": "FI", "48": "PL", "55": "BR", "54": "AR", "57": "CO", "56": "CL", "51": "PE",
  "61": "AU", "64": "NZ", "91": "IN", "81": "JP", "82": "KR", "86": "CN", "63": "PH",
};

export function parseCountryFromPhone(phone: string): string | null {
  const cleaned = phone.replace(/[^\d+]/g, "");
  if (!cleaned.startsWith("+")) return null;
  const num = cleaned.slice(1);
  for (const len of [3, 2, 1]) {
    const code = num.slice(0, len);
    if (CALLING_CODE_TO_ISO[code]) return CALLING_CODE_TO_ISO[code];
  }
  return null;
}

export type GateDecision = "standard" | "enhanced" | "block";
export interface GateResult {
  decision: GateDecision;
  country: string | null;
  age: number;
  minAge: number;
  confirmed: boolean;
  mechanism: string | null;
}

export async function evaluateAgeGate(phone: string, birthYear: number): Promise<GateResult> {
  const country = parseCountryFromPhone(phone);
  const age = new Date().getFullYear() - birthYear;

  let row: { minimum_age_for_self_consent: number; attorney_confirmed: boolean; required_consent_mechanism: string | null } | null = null;
  if (country) {
    const { data } = await getSupabaseAdmin()
      .from("age_consent_thresholds")
      .select("minimum_age_for_self_consent, attorney_confirmed, required_consent_mechanism")
      .eq("country_code", country)
      .maybeSingle();
    row = data;
  }
  const confirmed = row?.attorney_confirmed ?? false;
  const minAge = row?.minimum_age_for_self_consent ?? FAILSAFE_MIN_AGE;
  const mechanism = row?.required_consent_mechanism ?? null;

  if (!confirmed) {
    if (age < FAILSAFE_MIN_AGE) return { decision: "block", country, age, minAge: FAILSAFE_MIN_AGE, confirmed, mechanism };
    return { decision: "standard", country, age, minAge: FAILSAFE_MIN_AGE, confirmed, mechanism };
  }
  if (age >= minAge) return { decision: "standard", country, age, minAge, confirmed, mechanism };
  return { decision: "enhanced", country, age, minAge, confirmed, mechanism };
}
