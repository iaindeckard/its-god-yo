import { NextRequest, NextResponse } from "next/server";
import { FREEMIUM_PILOT_CAP, PILOT_RECRUITMENT_ENABLED } from "@/lib/flags";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: NextRequest) {
  if (!PILOT_RECRUITMENT_ENABLED) return NextResponse.json({ error: "Pilot enrollment is not open yet." }, { status: 404 });
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const audience = body?.audience_type;
  const name = typeof body?.contact_name === "string" ? body.contact_name.trim().slice(0, 120) : "";
  const email = typeof body?.contact_email === "string" ? body.contact_email.trim().toLowerCase().slice(0, 254) : "";
  const recipients = Number(body?.estimated_recipients || 1);
  if ((audience !== "family" && audience !== "church") || !name || !/^\S+@\S+\.\S+$/.test(email) || recipients < 1 || recipients > FREEMIUM_PILOT_CAP) {
    return NextResponse.json({ error: "Please check the required fields." }, { status: 400 });
  }
  const db = getSupabaseAdmin();
  const { error } = await db.from("pilot_interest").insert({
    audience_type: audience, contact_name: name, contact_email: email,
    organization_name: typeof body?.organization_name === "string" ? body.organization_name.trim().slice(0, 160) || null : null,
    estimated_recipients: recipients, source: "website_pilot",
  });
  if (error) return NextResponse.json({ error: "Could not save your interest." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
