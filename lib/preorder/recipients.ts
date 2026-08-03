import "server-only";
import { getSupabaseAdmin } from "../supabaseAdmin";

export interface PreorderRecipient {
  phone: string;
  name: string | null;
  lang: "en" | "es";
}

/**
 * The consent recipients (the people who reply YES) tied to a preorder signup:
 * one for individual/gift, N for family. Individual rows link via
 * pending_signups.teen_consent_id; family rows link via consent_log.pending_signup_id.
 */
export async function getSignupRecipients(
  signup: { id: string; teen_consent_id: string | null; plus_one_consent_id: string | null },
): Promise<PreorderRecipient[]> {
  const admin = getSupabaseAdmin();
  const linkIds = [signup.teen_consent_id, signup.plus_one_consent_id].filter(Boolean) as string[];
  const { data: familyRows } = await admin.from("consent_log").select("id").eq("pending_signup_id", signup.id);
  const ids = Array.from(new Set([...linkIds, ...((familyRows ?? []).map((r) => r.id as string))]));
  if (!ids.length) return [];
  const { data: rows } = await admin
    .from("consent_log")
    .select("recipient_phone, recipient_first_name, language")
    .in("id", ids)
    .neq("consent_status", "opted_out")
    .neq("consent_status", "expired");
  return (rows ?? [])
    .filter((r) => r.recipient_phone)
    .map((r) => ({ phone: r.recipient_phone as string, name: (r.recipient_first_name as string | null) ?? null, lang: r.language === "es" ? "es" : "en" }));
}
