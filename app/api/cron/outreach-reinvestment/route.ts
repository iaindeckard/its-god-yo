import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cronAuth";
import { generateReinvestmentProposal } from "@/lib/outreach/reinvestment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const proposal = await generateReinvestmentProposal(null);
    return NextResponse.json({ ok: true, created: Boolean(proposal), proposal });
  } catch (error) {
    console.error("[outreach-reinvestment] failed:", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "reinvestment_failed" }, { status: 500 });
  }
}
