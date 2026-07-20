-- Stage 2: capture a promo code at signup, SEPARATE from the referral code.
-- Mirrors the existing referral_code / referral_discount_applied columns. The
-- promo code is a Stripe PromotionCode (validated at signup); the future
-- subscription-creation webhook applies it at real billing time by its id.
--
-- promo_code                -> the customer-entered, validated code string
-- promo_promotion_code_id   -> the resolved Stripe promotion_code id (promo_...),
--                              so the webhook can apply it without re-resolving

ALTER TABLE public.pending_signups
  ADD COLUMN IF NOT EXISTS promo_code text,
  ADD COLUMN IF NOT EXISTS promo_promotion_code_id text;
