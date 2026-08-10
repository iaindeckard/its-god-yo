import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { CONVERSION_EVENTS } from "@/lib/conversionAnalytics";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowed = new Set<string>(CONVERSION_EVENTS);
const text = (v: unknown, max: number) => typeof v === "string" && v.length <= max ? v : null;

export async function POST(req: Request) {
  const length = Number(req.headers.get("content-length") || 0);
  if (length > 8_192) return NextResponse.json({ ok: false }, { status: 413 });
  const raw = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!raw || typeof raw.session_id !== "string" || !UUID.test(raw.session_id) || typeof raw.event_name !== "string" || !allowed.has(raw.event_name)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const properties = raw.properties && typeof raw.properties === "object" && !Array.isArray(raw.properties)
    ? Object.fromEntries(Object.entries(raw.properties as Record<string, unknown>).slice(0, 12).filter(([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v)).map(([k, v]) => [k.slice(0, 40), typeof v === "string" ? v.slice(0, 200) : v]))
    : {};
  const row = {
    session_id: raw.session_id, event_name: raw.event_name,
    page_path: text(raw.page_path, 200), audience: ["parent", "teen", "church"].includes(String(raw.audience)) ? raw.audience : null,
    plan_key: text(raw.plan_key, 80), acquisition_source: text(raw.acquisition_source, 120),
    acquisition_medium: text(raw.acquisition_medium, 120), acquisition_campaign: text(raw.acquisition_campaign, 160),
    pending_signup_id: typeof raw.pending_signup_id === "string" && UUID.test(raw.pending_signup_id) ? raw.pending_signup_id : null,
    properties,
  };
  const { error } = await getSupabaseAdmin().from("conversion_events").insert(row);
  if (error) return NextResponse.json({ ok: false }, { status: 500 });
  return NextResponse.json({ ok: true }, { status: 202 });
}
