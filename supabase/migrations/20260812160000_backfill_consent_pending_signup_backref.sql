-- Backfill the consent_log -> pending_signups back-reference.
--
-- The SMS STOP -> Stripe-cancel matcher (lib/twilioInbound.findConfirmedActiveSubscriber)
-- historically resolved the owning signup ONLY via consent_log.pending_signup_id and
-- skipped rows where that column was null. Because the link was maintained forward
-- only (pending_signups.teen_consent_id / plus_one_consent_id -> consent_log.id), a
-- confirmed subscriber whose back-reference was never populated could text STOP, be
-- marked opted_out, and KEEP GETTING BILLED (the trial converted / the sub renewed).
--
-- The app now also resolves via the forward link, so this backfill is defense-in-depth
-- plus clean data: populate the missing back-references from the forward link.
UPDATE public.consent_log cl
SET pending_signup_id = ps.id
FROM public.pending_signups ps
WHERE cl.pending_signup_id IS NULL
  AND (ps.teen_consent_id = cl.id OR ps.plus_one_consent_id = cl.id);
