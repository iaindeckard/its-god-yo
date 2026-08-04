import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lightweight "notify me when Spanish launches" email capture — NOT a preorder or
 * payment hold (Spanish content isn't ready). Stores the email in spanish_waitlist
 * (service-role write; the table is RLS-locked). Idempotent on the email.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  let body: { email?: string; source?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from("spanish_waitlist")
    .insert({ email, source: (body.source ?? "signup_language_step").slice(0, 60) });

  // 23505 = unique violation => already on the list; treat as success (idempotent).
  if (error && error.code !== "23505") {
    console.error("[spanish-waitlist] insert failed:", error.message);
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
