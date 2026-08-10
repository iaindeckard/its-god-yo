import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  const { data, error } = await getSupabaseAdmin().from("social_proof_items")
    .select("id,proof_type,headline,body,attribution")
    .eq("published", true).not("verified_at", "is", null)
    .order("display_order").limit(6);
  if (error) return NextResponse.json({ items: [] }, { status: 200 });
  return NextResponse.json({ items: data ?? [] }, { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" } });
}
