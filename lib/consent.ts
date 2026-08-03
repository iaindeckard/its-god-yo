import { toE164 } from "./phone";

/**
 * Client helper that POSTs the finished signup to the `submit-consent` Edge
 * Function. That function has verify_jwt=true, so the browser must send a valid
 * Supabase JWT — the ANON key (which is public-by-design and safe to ship in the
 * client bundle), NOT the newer sb_publishable_ key (that format doesn't satisfy
 * the functions-gateway JWT check).
 */
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://bkwtlfkhfbfyzgnozixw.supabase.co";
const ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJrd3RsZmtoZmJmeXpnbm96aXh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0ODc3NzMsImV4cCI6MjEwMDA2Mzc3M30.2d_GCThTXnL9wAVWjdqd_Agibl5etQy5NDoieyrEP1Q";

export interface ConsentPayload {
  language: "en" | "es";
  theme_track?: string;
  plan_key: string;
  base_price_id: string;
  group_teen_count?: number | null;
  dm_addon?: boolean;
  dm_addon_price_id?: string | null;
  referral_code?: string | null;
  referral_discount_applied?: boolean;
  promo_code?: string | null;
  promo_promotion_code_id?: string | null;
  // Affinity-code attestation (spec: IGY-Affinity-Promo-Codes-LOCKED-2026-07-21.md).
  // Set when the applied promo required an attestation and the purchaser checked
  // the box; the submit-consent function records these to promo_attestations and
  // flips pending_signups.promo_attestation_confirmed.
  promo_attestation_confirmed?: boolean;
  promo_attestation_text?: string | null; // the exact statement the purchaser confirmed
  purchaser_email?: string | null;
  // Browser-detected IANA timezone of the purchaser (parent) at signup. Feeds the
  // Stage 2 send-time fallback chain (used when a teen never sets their own tz on
  // the welcome page). Best-effort; null if the browser can't resolve it.
  purchaser_timezone?: string | null;
  // Purchaser / account-holder identity. Name is net new (only email/timezone
  // existed before). Salutation is a structured multi-select stored as an array;
  // an "Other" free-text entry is just another element.
  purchaser_first_name?: string | null;
  purchaser_last_name?: string | null;
  purchaser_salutation?: string[];
  teen?: { first_name: string; phone: string; birth_year?: number; enhanced_consent_ack?: boolean };
  family_teens?: Array<{ first_name: string; phone: string; birth_year?: number; enhanced_consent_ack?: boolean }>;
  // NOTE: the former `plus_one` (second-recipient) input was removed 2026-08-01 when
  // DM from Him was redefined as a single-subscriber add-on that wraps the SAME
  // recipient's daily verse (no second person). `dm_addon` above is the toggle now.
  stripe?: { customer_id?: string; setup_intent_id?: string; payment_method_id?: string };
}

export interface ConsentResult {
  status: string;
  message: string;
  pending_signup_id: string;
  sms_would_send: Array<{ kind: string; to: string; body: string }>;
}

export async function submitConsent(payload: ConsentPayload): Promise<ConsentResult> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/submit-consent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON,
      Authorization: `Bearer ${ANON}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `submit failed (${res.status})`);
  return data as ConsentResult;
}

/** Canonical E.164 normalization for storage/sending. Delegates to the shared
 *  lib/phone.toE164 (single source of truth). Country is unknown at this client
 *  call site, so bare 10-digit numbers default to +1; the submit-consent Edge
 *  Function re-canonicalizes with each recipient's derived country. */
export function normalizePhone(raw: string): string {
  return toE164(raw);
}
