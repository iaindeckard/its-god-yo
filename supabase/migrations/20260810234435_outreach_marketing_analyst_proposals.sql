-- AI marketing analysis is proposal-layer only. A generated plan cannot alter a
-- campaign, promote a lead, open the outreach gate, or send mail. An authorized
-- staff member must explicitly approve one recommendation; that separate server
-- action creates an ordinary draft campaign governed by every existing gate.
CREATE TABLE IF NOT EXISTS public.outreach_marketing_proposals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  objective          text NOT NULL,
  audience           text NOT NULL,
  budget_level       text NOT NULL,
  preferred_window   text,
  constraints        text,
  analysis           jsonb NOT NULL,
  status             text NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'approved', 'rejected')),
  created_by         uuid,
  approved_by        uuid,
  approved_at        timestamptz,
  approved_market_index integer,
  campaign_id        uuid REFERENCES public.outreach_campaigns (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.outreach_marketing_proposals ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_outreach_marketing_proposals_status_created
  ON public.outreach_marketing_proposals (status, created_at DESC);

COMMENT ON TABLE public.outreach_marketing_proposals IS
  'Human-review proposal layer for AI marketing analysis. Service-role only; approval creates a draft campaign but never sends.';
