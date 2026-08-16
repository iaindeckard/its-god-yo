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
  category?: string;
  publisher?: string;
}

export interface MarketIntelligenceProfile {
  area_demographics: Record<string, unknown>;
  congregation_landscape: Record<string, unknown>;
  attendee_profile: { sourced_segments: string[]; limitations: string[] };
  economics: Record<string, unknown>;
  public_outreach: { signals: string[]; opportunities: string[] };
}

export interface CampaignStrategy {
  campaign_type: string;
  denomination_filters: string[];
  size_filters: string[];
  discount_percent: number;
  investment_cents: number;
  message_variant: "default";
  rationale: string;
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
  profile: MarketIntelligenceProfile;
  campaign_strategy: CampaignStrategy;
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

  const recommendations = raw.recommendations.slice(0, 3).map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error(`analyst_invalid_market_${index}`);
    const item = entry as Record<string, unknown>;
    const timing = (item.timing && typeof item.timing === "object" ? item.timing : {}) as Record<string, unknown>;
    const message = (item.message && typeof item.message === "object" ? item.message : {}) as Record<string, unknown>;
    const evidence = Array.isArray(item.evidence)
      ? item.evidence.map((row) => {
          const evidenceRow = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
          return { claim: safeString(evidenceRow.claim), url: safeString(evidenceRow.url), category: safeString(evidenceRow.category), publisher: safeString(evidenceRow.publisher) };
        }).filter((row) => row.claim && /^https?:\/\//.test(row.url))
      : [];
    const marketName = safeString(item.market_name);
    const centerLabel = safeString(item.center_label);
    if (!marketName || !centerLabel || evidence.length === 0) throw new Error(`analyst_ungrounded_market_${index}`);
    const profile = (item.profile && typeof item.profile === "object" ? item.profile : {}) as Record<string, unknown>;
    const attendee = (profile.attendee_profile && typeof profile.attendee_profile === "object" ? profile.attendee_profile : {}) as Record<string, unknown>;
    const outreach = (profile.public_outreach && typeof profile.public_outreach === "object" ? profile.public_outreach : {}) as Record<string, unknown>;
    const strategy = (item.campaign_strategy && typeof item.campaign_strategy === "object" ? item.campaign_strategy : {}) as Record<string, unknown>;
    const denominationFilters = safeStrings(strategy.denomination_filters).filter((value) => ["usccb","episcopal","umc","elca","pcusa","sbc","lcms"].includes(value));
    const sizeFilters = safeStrings(strategy.size_filters).filter((value) => ["small","medium","large","mega","unknown"].includes(value));
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
      profile: {
        area_demographics: (profile.area_demographics && typeof profile.area_demographics === "object" ? profile.area_demographics : {}) as Record<string, unknown>,
        congregation_landscape: (profile.congregation_landscape && typeof profile.congregation_landscape === "object" ? profile.congregation_landscape : {}) as Record<string, unknown>,
        attendee_profile: { sourced_segments: safeStrings(attendee.sourced_segments), limitations: safeStrings(attendee.limitations) },
        economics: (profile.economics && typeof profile.economics === "object" ? profile.economics : {}) as Record<string, unknown>,
        public_outreach: { signals: safeStrings(outreach.signals), opportunities: safeStrings(outreach.opportunities) },
      },
      campaign_strategy: {
        campaign_type: safeString(strategy.campaign_type) || "controlled_church_outreach_test",
        denomination_filters: denominationFilters,
        size_filters: sizeFilters,
        discount_percent: Math.min(25, Math.max(0, Math.round(Number(strategy.discount_percent) || 10))),
        investment_cents: Math.max(0, Math.round(Number(strategy.investment_cents) || 0)),
        message_variant: "default" as const,
        rationale: safeString(strategy.rationale),
      },
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
