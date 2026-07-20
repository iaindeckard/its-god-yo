import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Service-role Supabase client — SERVER ONLY. Reads the RBAC tables and the
 *  service-role-locked tables (consent_log, pending_signups, daily_slots). Never
 *  import this from a client component; the service role bypasses RLS. */
let _admin: SupabaseClient | null = null;
export function getSupabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://bkwtlfkhfbfyzgnozixw.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  _admin = createClient(url, key, { auth: { persistSession: false } });
  return _admin;
}
