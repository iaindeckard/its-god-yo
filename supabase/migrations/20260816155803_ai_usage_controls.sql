-- Central, service-role-only controls and accounting for paid AI requests.
CREATE TABLE public.ai_usage_policy (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT true,
  monthly_budget_microusd bigint NOT NULL DEFAULT 25000000 CHECK (monthly_budget_microusd >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

INSERT INTO public.ai_usage_policy (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

CREATE TABLE public.ai_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('openai')),
  feature text NOT NULL CHECK (feature IN ('marketing_analyst', 'bounty_assessment', 'outreach_discovery')),
  request_key text NOT NULL UNIQUE,
  provider_response_id text UNIQUE,
  model text NOT NULL,
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'completed', 'failed')),
  reserved_cost_microusd bigint NOT NULL CHECK (reserved_cost_microusd >= 0),
  estimated_cost_microusd bigint,
  input_tokens bigint,
  cached_input_tokens bigint,
  output_tokens bigint,
  reasoning_tokens bigint,
  web_search_calls integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE public.ai_usage_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_usage_policy FROM anon, authenticated;
REVOKE ALL ON public.ai_usage_events FROM anon, authenticated;
GRANT ALL ON public.ai_usage_policy TO service_role;
GRANT ALL ON public.ai_usage_events TO service_role;

CREATE INDEX ai_usage_events_month_idx ON public.ai_usage_events (created_at DESC, status);

CREATE OR REPLACE FUNCTION public.reserve_ai_usage(
  p_feature text,
  p_request_key text,
  p_model text,
  p_reserved_cost_microusd bigint,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS public.ai_usage_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  policy public.ai_usage_policy;
  spent bigint;
  existing public.ai_usage_events;
  created public.ai_usage_events;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('ai_usage_monthly_budget'));
  SELECT * INTO existing FROM public.ai_usage_events WHERE request_key = p_request_key;
  IF FOUND AND existing.status = 'failed' THEN
    DELETE FROM public.ai_usage_events WHERE id = existing.id;
  ELSIF FOUND THEN
    RAISE EXCEPTION 'ai_request_already_exists';
  END IF;
  SELECT * INTO policy FROM public.ai_usage_policy WHERE id = true;
  IF NOT policy.enabled THEN RAISE EXCEPTION 'ai_usage_disabled'; END IF;
  SELECT COALESCE(SUM(CASE WHEN status = 'completed' THEN COALESCE(estimated_cost_microusd, reserved_cost_microusd) ELSE reserved_cost_microusd END), 0)
    INTO spent
    FROM public.ai_usage_events
   WHERE status IN ('reserved', 'completed')
     AND created_at >= date_trunc('month', now());
  IF spent + p_reserved_cost_microusd > policy.monthly_budget_microusd THEN
    RAISE EXCEPTION 'ai_monthly_budget_exceeded';
  END IF;
  INSERT INTO public.ai_usage_events (provider, feature, request_key, model, reserved_cost_microusd, metadata)
  VALUES ('openai', p_feature, p_request_key, p_model, p_reserved_cost_microusd, COALESCE(p_metadata, '{}'::jsonb))
  RETURNING * INTO created;
  RETURN created;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_ai_usage(text, text, text, bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_ai_usage(text, text, text, bigint, jsonb) TO service_role;

COMMENT ON TABLE public.ai_usage_events IS 'Service-role-only OpenAI usage and estimated cost ledger with pre-request reservations.';
