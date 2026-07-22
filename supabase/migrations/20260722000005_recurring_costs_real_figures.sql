-- Real recurring-cost figures from the GoDaddy/Microsoft receipts (2026-07-22),
-- replacing the domain placeholder seeded in 20260722000004.
--
--   Domain (itsgodyo.com, .com): $31.38 for the CURRENT 2-year term (2026-2028)
--     => $15.69/yr for daily proration now. Renews 2028 at $45.98/2yr
--     ($22.99/yr) — noted for a future update at renewal.
--   Microsoft 365 Email Essentials (hello@itsgodyo.com): $9.99/month — added as
--     its own line.
--
-- NOT added: GoDaddy "Websites + Marketing Lite" ($83.88/yr, renews $119.88/yr,
--   itsgodyo.godaddysites.com) — that's the old GoDaddy Website Builder
--   placeholder, unrelated to the real Vercel site, and Iain is cancelling it.

-- Domain: real annualized figure, now confirmed.
UPDATE public.igy_recurring_costs
SET amount_cents = 1569,        -- $15.69/yr (= $31.38 / 2yr term)
    source       = 'confirmed',
    notes        = '$31.38 for the current 2-year term 2026-07-20 -> 2028-07-20 ($15.69/yr). Renews 2028 at $45.98/2yr ($22.99/yr) — update amount_cents to 2299 at that point.',
    updated_at   = now()
WHERE vendor = 'GoDaddy' AND description = 'Domain registration — itsgodyo.com (.com)';

-- Microsoft 365 Email Essentials — new recurring line.
INSERT INTO public.igy_recurring_costs (vendor, description, amount_cents, cadence, source, notes, effective_start)
SELECT 'Microsoft 365', 'Email Essentials — hello@itsgodyo.com', 999, 'monthly', 'confirmed',
       'Mailbox for hello@itsgodyo.com. $9.99/month.', DATE '2026-07-20'
WHERE NOT EXISTS (
  SELECT 1 FROM public.igy_recurring_costs
  WHERE vendor = 'Microsoft 365' AND description = 'Email Essentials — hello@itsgodyo.com'
);
