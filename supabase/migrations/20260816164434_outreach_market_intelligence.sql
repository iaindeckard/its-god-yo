-- Persist the evidence and strategy behind automatically generated draft campaigns.
-- These records are back-office only and never authorize discovery, promotion,
-- scheduling, or sending.
CREATE TABLE public.outreach_market_intelligence_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES public.outreach_marketing_proposals(id) ON DELETE CASCADE,
  recommendation_index integer NOT NULL CHECK (recommendation_index >= 0 AND recommendation_index < 5),
  campaign_id uuid UNIQUE REFERENCES public.outreach_campaigns(id) ON DELETE SET NULL,
  market_name text NOT NULL,
  center_label text NOT NULL,
  state_code text,
  area_demographics jsonb NOT NULL DEFAULT '{}'::jsonb,
  congregation_landscape jsonb NOT NULL DEFAULT '{}'::jsonb,
  attendee_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  economics jsonb NOT NULL DEFAULT '{}'::jsonb,
  public_outreach jsonb NOT NULL DEFAULT '{}'::jsonb,
  campaign_strategy jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  data_limitations jsonb NOT NULL DEFAULT '[]'::jsonb,
  verified_data_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (proposal_id, recommendation_index)
);

ALTER TABLE public.outreach_marketing_proposals
  ADD COLUMN IF NOT EXISTS auto_drafts_created_at timestamptz;

ALTER TABLE public.outreach_campaigns
  ADD COLUMN IF NOT EXISTS discovery_target_count integer
  CHECK (discovery_target_count IS NULL OR discovery_target_count BETWEEN 1 AND 250);

ALTER TABLE public.outreach_market_intelligence_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.outreach_market_intelligence_profiles FROM anon, authenticated;
GRANT ALL ON public.outreach_market_intelligence_profiles TO service_role;

CREATE INDEX outreach_market_profiles_proposal_idx
  ON public.outreach_market_intelligence_profiles(proposal_id, recommendation_index);

COMMENT ON TABLE public.outreach_market_intelligence_profiles IS
  'Service-role-only sourced market profiles and draft strategy. Campaigns remain draft until separate human-controlled steps.';
