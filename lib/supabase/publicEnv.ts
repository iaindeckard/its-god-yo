// Public Supabase connection values (URL + anon key). Both are public-by-design
// (the anon key is a client-shipped JWT). Single source of truth for the
// @supabase/ssr clients + middleware. Fallbacks match lib/reviewFunctions.ts so
// the app works even when NEXT_PUBLIC_SUPABASE_* are unset in .env.local.
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://bkwtlfkhfbfyzgnozixw.supabase.co";
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJrd3RsZmtoZmJmeXpnbm96aXh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0ODc3NzMsImV4cCI6MjEwMDA2Mzc3M30.2d_GCThTXnL9wAVWjdqd_Agibl5etQy5NDoieyrEP1Q";
