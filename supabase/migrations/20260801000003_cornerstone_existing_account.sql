-- Cornerstone: capture the applicant's existing It's God, Yo! account (if any) from
-- the public application form. A public applicant can't supply a user UUID, so this
-- is a free-text email hint for staff — kept out of internal_notes (which the
-- decline flow overwrites). Nullable + additive; no impact on any existing flow.
ALTER TABLE public.cornerstone_applications
  ADD COLUMN IF NOT EXISTS existing_account_email text;
