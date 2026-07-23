-- Add Resend Pro as a known flat recurring cost. $20.00/month ($240/yr) for
-- sending sponsor-inquiry notification emails from a verified itsgodyo.com
-- sender. cadence='monthly' so the donation-fund daily-close prorates it the
-- same exact way as the other monthly costs: amount_cents / days in the target
-- month (e.g. 2000 / 31 in a 31-day month). Effective 2026-07-23.
INSERT INTO public.igy_recurring_costs (vendor, description, amount_cents, cadence, source, notes, effective_start)
SELECT 'Resend',
       'Resend Pro — sponsor-inquiry notification email (verified itsgodyo.com sender)',
       2000, 'monthly', 'confirmed',
       '$20.00/month ($240/yr). Upgraded to Pro + verified itsgodyo.com so sponsor-inquiry notifications send to hello@itsgodyo.com.',
       DATE '2026-07-23'
WHERE NOT EXISTS (
  SELECT 1 FROM public.igy_recurring_costs WHERE vendor = 'Resend' AND description LIKE 'Resend Pro%'
);
