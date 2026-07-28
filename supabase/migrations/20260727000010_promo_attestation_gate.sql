-- Affinity promo-code attestation gate.
-- Spec: IGY-Affinity-Promo-Codes-LOCKED-2026-07-21.md — codes like igy_episcopal
-- (15% off) and igy_hardtner (10% off) are gated behind a signup attestation
-- checkbox ("I attest that I am an Episcopalian…"), with the text + version +
-- timestamp logged for audit "same audit pattern as the existing gifter
-- attestation."
--
-- WHY A DEDICATED TABLE (not consent_log): consent_log is structurally about a
-- teen SMS recipient — recipient_phone and disclosure_text are NOT NULL there.
-- A promo attestation is the PURCHASER attesting affinity; it has no recipient
-- phone and no SMS disclosure. The LOCKED doc allows "consent_log OR an
-- equivalent table" — this is that equivalent, mirroring the audit fields
-- (attestation_text / _version / confirmed_at).

CREATE TABLE IF NOT EXISTS public.promo_attestations (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pending_signup_id         uuid REFERENCES public.pending_signups(id) ON DELETE SET NULL,
  promo_code                text NOT NULL,
  promo_promotion_code_id   text,
  purchaser_email           text,
  language                  text,
  attestation_text          text NOT NULL,     -- the exact text the purchaser confirmed
  attestation_text_version  text NOT NULL,     -- version of that copy (audit)
  confirmed_at              timestamptz NOT NULL DEFAULT now(),
  created_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_promo_attestations_signup ON public.promo_attestations (pending_signup_id);
CREATE INDEX IF NOT EXISTS idx_promo_attestations_code ON public.promo_attestations (promo_code);

-- Service-role only (same posture as consent_log): written by the submit-consent
-- Edge Function; never read/written by the public anon key.
ALTER TABLE public.promo_attestations ENABLE ROW LEVEL SECURITY;

-- The server-side flag Iain asked for: enforced at subscription-creation time
-- (lib/createSubscription.ts + lib/familyBilling.ts refuse to apply an
-- attestation-required promo discount unless this is true). promo_attestation_id
-- links to the audit row above.
ALTER TABLE public.pending_signups
  ADD COLUMN IF NOT EXISTS promo_attestation_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS promo_attestation_id uuid REFERENCES public.promo_attestations(id) ON DELETE SET NULL;
