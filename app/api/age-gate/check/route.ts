import { NextResponse } from "next/server";
import { evaluateAgeGate } from "@/lib/ageGate";

export const dynamic = "force-dynamic";

/**
 * Customer-facing PREVIEW of the age-consent decision for the signup UI. NOT the
 * enforcement point — submit-consent re-evaluates server-side and is the real
 * gate. Returns the decision so the UI can show the block message / enhanced
 * shell / standard flow for the given phone + birth year.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const phone = typeof body.phone === "string" ? body.phone : "";
  const birthYear = Number(body.birth_year);
  if (!phone.trim() || !Number.isInteger(birthYear)) {
    return NextResponse.json({ error: "phone and birth_year are required" }, { status: 400 });
  }
  const currentYear = new Date().getFullYear();
  if (birthYear < currentYear - 120 || birthYear > currentYear) {
    return NextResponse.json({ error: "birth_year out of range" }, { status: 400 });
  }
  const g = await evaluateAgeGate(phone, birthYear);
  return NextResponse.json({
    decision: g.decision,
    country: g.country,
    age: g.age,
    min_age: g.minAge,
    confirmed: g.confirmed,
    mechanism: g.mechanism,
  });
}
