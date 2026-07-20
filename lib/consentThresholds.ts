import "server-only";
import { getSupabaseAdmin } from "./supabaseAdmin";

export interface ThresholdRow {
  country_code: string;
  minimum_age_for_self_consent: number;
  attorney_confirmed: boolean;
  attorney_confirmed_at: string | null;
  attorney_confirmed_by: string | null;
  required_consent_mechanism: string | null;
  notes: string | null;
  updated_at: string;
}

export async function listThresholds(): Promise<ThresholdRow[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("age_consent_thresholds")
    .select("*")
    .order("country_code");
  if (error) throw new Error(error.message);
  return (data ?? []) as ThresholdRow[];
}

export interface ThresholdPatch {
  minimum_age_for_self_consent?: number;
  attorney_confirmed?: boolean;
  attorney_confirmed_by?: string | null;
  required_consent_mechanism?: string | null;
  notes?: string | null;
}

export async function updateThreshold(country: string, patch: ThresholdPatch): Promise<ThresholdRow> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.minimum_age_for_self_consent !== undefined) update.minimum_age_for_self_consent = patch.minimum_age_for_self_consent;
  if (patch.attorney_confirmed !== undefined) {
    update.attorney_confirmed = patch.attorney_confirmed;
    // Stamp the confirmation time when flipping ON; clear it when flipping OFF.
    update.attorney_confirmed_at = patch.attorney_confirmed ? new Date().toISOString() : null;
  }
  if (patch.attorney_confirmed_by !== undefined) update.attorney_confirmed_by = patch.attorney_confirmed_by;
  if (patch.required_consent_mechanism !== undefined) update.required_consent_mechanism = patch.required_consent_mechanism;
  if (patch.notes !== undefined) update.notes = patch.notes;

  const { data, error } = await getSupabaseAdmin()
    .from("age_consent_thresholds")
    .update(update)
    .eq("country_code", country)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as ThresholdRow;
}

export async function createThreshold(country_code: string): Promise<ThresholdRow> {
  // New countries start at the strictest default, UNCONFIRMED — same fail-safe
  // posture as the seeded rows. Never created pre-confirmed.
  const { data, error } = await getSupabaseAdmin()
    .from("age_consent_thresholds")
    .insert({ country_code: country_code.toUpperCase(), minimum_age_for_self_consent: 16, attorney_confirmed: false })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as ThresholdRow;
}
