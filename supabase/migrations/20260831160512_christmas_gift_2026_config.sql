-- Christmas Scheduled Gift 2026 — single-row admin config (mirrors cornerstone_config).
-- Drives the seasonal campaign WITHOUT a redeploy: sale window, early-bird cutoff,
-- Black Friday flash window + discount, campaign close, and the max buyer-selectable
-- release date. All datetimes America/Chicago (Wichita KS), matching the cause_promotions
-- convention. NONE of these are hardcoded in app code — checkout reads this row and fails
-- closed if it is missing/ambiguous. campaign_active defaults false so nothing goes live
-- until Iain flips it. Posture: RLS enabled, NO policies => service-role only.
CREATE TABLE IF NOT EXISTS public.christmas_gift_2026_config (
  id                      boolean PRIMARY KEY DEFAULT true CHECK (id),   -- enforces exactly one row
  campaign_active         boolean NOT NULL DEFAULT false,                -- master on/off; false => checkout rejects
  sale_opens_at           timestamptz,        -- Sept 1, 2026 00:00 CT
  early_bird_cutoff_at    timestamptz,        -- Thanksgiving Nov 26, 2026 23:59:59 CT (inclusive end of early-bird)
  flash_sale_starts_at    timestamptz,        -- Nov 27, 2026 00:00 CT
  flash_sale_ends_at      timestamptz,        -- Dec 3, 2026 23:59:59 CT
  flash_sale_discount_pct numeric NOT NULL DEFAULT 20
                            CHECK (flash_sale_discount_pct >= 0 AND flash_sale_discount_pct <= 100),
  campaign_closes_at      timestamptz,        -- last moment a purchase is accepted (~mid/late Dec)
  max_release_at          date,               -- latest release date a buyer may choose (e.g. Christmas Day)
  list_price_cents        integer NOT NULL DEFAULT 5900,  -- standard Scheduled Gift price; keep in sync w/ igy_gift_annual
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid
);

-- Seed the single row with the LOCKED v6 dates (America/Chicago literals -> stored as UTC).
-- campaign_active stays FALSE: this only pre-loads the schedule; Iain flips the switch to go live.
INSERT INTO public.christmas_gift_2026_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
UPDATE public.christmas_gift_2026_config SET
  sale_opens_at           = '2026-09-01 00:00:00 America/Chicago'::timestamptz,
  early_bird_cutoff_at    = '2026-11-26 23:59:59 America/Chicago'::timestamptz,
  flash_sale_starts_at    = '2026-11-27 00:00:00 America/Chicago'::timestamptz,
  flash_sale_ends_at      = '2026-12-03 23:59:59 America/Chicago'::timestamptz,
  flash_sale_discount_pct = 20,
  campaign_closes_at      = '2026-12-22 23:59:59 America/Chicago'::timestamptz,  -- last purchase accepted (gap before max release)
  max_release_at          = '2026-12-25'::date,                                  -- latest release date a buyer may choose
  list_price_cents        = 5900
WHERE id;

ALTER TABLE public.christmas_gift_2026_config ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only.
