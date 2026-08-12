export const MARKETING_OBJECTIVES = [
  "parent_purchases",
  "church_enrollment",
  "referral_growth",
  "seasonal_promotion",
  "retention_reactivation",
  "partner_recruitment",
] as const;

export type MarketingObjective = (typeof MARKETING_OBJECTIVES)[number];

export interface MarketingEvidence {
  claim: string;
  url: string;
}

export interface MarketRecommendation {
  market_name: string;
  state: string;
  center_label: string;
  radius_miles: number;
  score: number;
  why_now: string;
  audience: string;
  timing: { start: string; end: string; rationale: string };
  message: {
    theme: string;
    value_proposition: string;
    call_to_action: string;
    subject_line: string;
    opening: string;
  };
  channels: string[];
  test_size: number;
  success_metrics: string[];
  risks: string[];
  assumptions: string[];
  evidence: MarketingEvidence[];
}

export interface MarketingAnalysis {
  executive_summary: string;
  next_action: string;
  recommendations: MarketRecommendation[];
  data_limitations: string[];
  generated_at: string;
}

export interface MarketingAnalysisInput {
  objective: MarketingObjective;
  audience: string;
  budget_level: "small_test" | "moderate" | "growth";
  preferred_window?: string;
  constraints?: string;
}

const safeString = (value: unknown) => typeof value === "string" ? value.trim() : "";
const safeStrings = (value: unknown) => Array.isArray(value) ? value.map(safeString).filter(Boolean) : [];

export function parseMarketingAnalysis(value: unknown, generatedAt = new Date().toISOString()): MarketingAnalysis {
  if (!value || typeof value !== "object") throw new Error("analyst_invalid_response");
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.recommendations)) throw new Error("analyst_missing_recommendations");

  const recommendations = raw.recommendations.slice(0, 5).map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error(`analyst_invalid_market_${index}`);
    const item = entry as Record<string, unknown>;
    const timing = (item.timing && typeof item.timing === "object" ? item.timing : {}) as Record<string, unknown>;
    const message = (item.message && typeof item.message === "object" ? item.message : {}) as Record<string, unknown>;
    const evidence = Array.isArray(item.evidence)
      ? item.evidence.map((row) => {
          const evidenceRow = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
          return { claim: safeString(evidenceRow.claim), url: safeString(evidenceRow.url) };
        }).filter((row) => row.claim && /^https?:\/\//.test(row.url))
      : [];
    const marketName = safeString(item.market_name);
    const centerLabel = safeString(item.center_label);
    if (!marketName || !centerLabel || evidence.length === 0) throw new Error(`analyst_ungrounded_market_${index}`);
    return {
      market_name: marketName,
      state: safeString(item.state),
      center_label: centerLabel,
      radius_miles: Math.min(100, Math.max(5, Math.round(Number(item.radius_miles) || 25))),
      score: Math.min(100, Math.max(0, Math.round(Number(item.score) || 0))),
      why_now: safeString(item.why_now),
      audience: safeString(item.audience),
      timing: { start: safeString(timing.start), end: safeString(timing.end), rationale: safeString(timing.rationale) },
      message: {
        theme: safeString(message.theme),
        value_proposition: safeString(message.value_proposition),
        call_to_action: safeString(message.call_to_action),
        subject_line: safeString(message.subject_line),
        opening: safeString(message.opening),
      },
      channels: safeStrings(item.channels),
      test_size: Math.min(250, Math.max(5, Math.round(Number(item.test_size) || 25))),
      success_metrics: safeStrings(item.success_metrics),
      risks: safeStrings(item.risks),
      assumptions: safeStrings(item.assumptions),
      evidence,
    };
  });
  if (recommendations.length === 0) throw new Error("analyst_no_grounded_markets");

  return {
    executive_summary: safeString(raw.executive_summary),
    next_action: safeString(raw.next_action),
    recommendations: recommendations.sort((a, b) => b.score - a.score),
    data_limitations: safeStrings(raw.data_limitations),
    generated_at: generatedAt,
  };
}
