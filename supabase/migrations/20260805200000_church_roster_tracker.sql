-- Church group enrollment — Phase 2, roster tracker (names-only progress display).
--
-- A minister may OPTIONALLY paste a plain list of teen first names (NO contact
-- info, ever) so their Cornerstone dashboard can show "X of N on your list have
-- joined." This is a display convenience ONLY: it never sends a text, never
-- collects a phone number, and never enrolls anyone. Matching is compute-on-read
-- against the first names teens enter in their OWN self-signup — so there is no
-- hot-path / edge-function change and no persisted match state to drift.

-- Shared, immutable name-normalization so the roster's stored key and the match
-- view use byte-identical logic: lowercase, strip everything but alphanumerics.
CREATE OR REPLACE FUNCTION public.igy_norm_name(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$ SELECT lower(regexp_replace(coalesce(t, ''), '[^[:alnum:]]', '', 'g')) $$;

-- ---------------------------------------------------------------------------
-- church_roster_names — the minister's optional name list. First names only.
-- normalized_name is generated (the match key); unique per partner so a pasted
-- list is naturally de-duped.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.church_roster_names (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cornerstone_partner_id uuid NOT NULL REFERENCES public.cornerstone_partners (id) ON DELETE CASCADE,
  first_name             text NOT NULL,
  normalized_name        text GENERATED ALWAYS AS (public.igy_norm_name(first_name)) STORED,
  created_by             uuid,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_church_roster_partner_norm
  ON public.church_roster_names (cornerstone_partner_id, normalized_name);

-- ---------------------------------------------------------------------------
-- v_church_roster_status — per roster name, is there an attributed signup whose
-- first name matches, and did it reach "joined" (a subscription exists)? Covers
-- BOTH signup shapes: individual (pending_signups.teen_consent_id -> consent_log)
-- and family (consent_log.pending_signup_id -> the N teen rows).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_church_roster_status
WITH (security_invoker = true) AS
WITH attributed AS (
  SELECT
    ps.cornerstone_partner_id                       AS partner_id,
    public.igy_norm_name(cl.recipient_first_name)   AS norm,
    bool_or(ps.status IN
      ('confirmed','subscription_created','active','past_due','requires_action')) AS joined
  FROM public.pending_signups ps
  JOIN public.consent_log cl
    ON (cl.id = ps.teen_consent_id OR cl.pending_signup_id = ps.id)
  WHERE ps.cornerstone_partner_id IS NOT NULL
  GROUP BY 1, 2
)
SELECT
  r.cornerstone_partner_id,
  r.id                          AS roster_id,
  r.first_name,
  r.normalized_name,
  (a.norm IS NOT NULL)          AS matched,
  COALESCE(a.joined, false)     AS joined
FROM public.church_roster_names r
LEFT JOIN attributed a
  ON a.partner_id = r.cornerstone_partner_id
 AND a.norm = r.normalized_name;

-- RLS: service-role only, matching the other church-enrollment tables.
ALTER TABLE public.church_roster_names ENABLE ROW LEVEL SECURITY;
