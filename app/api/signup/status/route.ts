import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const pendingSignupId = typeof body.pending_signup_id === "string" ? body.pending_signup_id : "";
  const email = typeof body.purchaser_email === "string" ? body.purchaser_email.trim().toLowerCase() : "";
  if (!pendingSignupId || !email) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const admin = getSupabaseAdmin();
  const { data: signup } = await admin.from("pending_signups").select("id,purchaser_email").eq("id", pendingSignupId).maybeSingle();
  if (!signup || String(signup.purchaser_email || "").trim().toLowerCase() !== email) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { data, error } = await admin.from("signup_status_tokens").upsert({
    pending_signup_id: pendingSignupId,
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  }, { onConflict: "pending_signup_id" }).select("token").single();
  if (error || !data) return NextResponse.json({ error: "unavailable" }, { status: 500 });
  return NextResponse.json({ url: `/signup/status?token=${data.token}` });
}
