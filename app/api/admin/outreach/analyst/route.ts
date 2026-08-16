import { NextResponse } from "next/server";
import { requirePermission, getCurrentStaff } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { MARKETING_OBJECTIVES, type MarketingAnalysisInput } from "@/lib/outreach/marketing-analysis";
import { generateMarketingAnalysis, saveMarketingProposal } from "@/lib/outreach/marketing-analyst";
import { getAiUsageSummary } from "@/lib/ai-usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    await requirePermission("marketing.outreach.manage");
    const staff = await getCurrentStaff();
    const body = await req.json().catch(() => ({}));
    const requestId = typeof body.request_id === "string" && /^[0-9a-f-]{36}$/i.test(body.request_id) ? body.request_id : crypto.randomUUID();
    if (!MARKETING_OBJECTIVES.includes(body.objective)) return NextResponse.json({ error: "invalid objective" }, { status: 400 });
    const audience = typeof body.audience === "string" ? body.audience.trim() : "";
    if (!audience) return NextResponse.json({ error: "audience is required" }, { status: 400 });
    const budget = ["small_test", "moderate", "growth"].includes(body.budget_level) ? body.budget_level : "small_test";
    const input: MarketingAnalysisInput = {
      objective: body.objective,
      audience,
      budget_level: budget,
      preferred_window: typeof body.preferred_window === "string" ? body.preferred_window.trim().slice(0, 120) : "",
      constraints: typeof body.constraints === "string" ? body.constraints.trim().slice(0, 1000) : "",
    };
    const analysis = await generateMarketingAnalysis(input, `marketing_analyst:${requestId}`);
    const proposal = await saveMarketingProposal(input, analysis, staff?.userId ?? null);
    const aiUsage = await getAiUsageSummary();
    return NextResponse.json({ proposal, aiUsage });
  } catch (error) {
    return apiError(error);
  }
}
