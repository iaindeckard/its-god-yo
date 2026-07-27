# Affinity promo-code attestation gate

> # 🚨 LAUNCH BLOCKER — DEPLOY ORDER IS NOT OPTIONAL
> **Deploy the `submit-consent` edge function BEFORE (or together with) the Next app. Never ship the app gate alone.**
>
> **The edge function is the ONLY thing that records the attestation and sets
> `pending_signups.promo_attestation_confirmed`. If the app gate ships without it:**
> - **the attestation is silently NOT recorded** (empty `promo_attestations` audit trail — a legal/compliance gap for a code that's supposed to be attested), and
> - **the affinity discount is dropped at billing even for people who DID attest** (the server gate reads a flag that never got set).
>
> **This is fail-closed on money but fail-silent on the audit record. Do not treat it as a footnote. See "Deploy ordering" below for the exact command order.**

## Pieces
- **Migration** `20260727000010_promo_attestation_gate.sql` (applied): `promo_attestations`
  audit table + `pending_signups.promo_attestation_confirmed` flag + `promo_attestation_id`.
  (Uses a dedicated table, not `consent_log` — that table's `recipient_phone`/`disclosure_text`
  are NOT NULL and are about teen SMS consent, not a purchaser attestation. The LOCKED doc
  allows "consent_log or an equivalent table.")
- **Client** `app/signup/SignupFlow.tsx`: when `/api/promo/validate` returns
  `requires_attestation:true`, renders the code's `attestation_text` as a required checkbox and
  **blocks continuing past payment** until it's checked. Sends `promo_attestation_confirmed` +
  `promo_attestation_text` in the consent payload (`lib/consent.ts`).
- **Edge function** `submit-consent`: `recordPromoAttestation()` writes the `promo_attestations`
  audit row (text + version + timestamp) and flips `pending_signups.promo_attestation_confirmed`.
- **Authoritative server gate** `lib/promoCodes.ts` `promoAttestationSatisfied()`, called from
  `lib/createSubscription.ts` and `lib/familyBilling.ts`: at subscription creation, an
  attestation-required promo discount is **only applied when the flag is set**. Non-attestation
  codes (referral, church-outreach 10%) are unaffected — the check keys strictly on the code's
  `requires_attestation` metadata.

## ⚠️ Deploy ordering — LAUNCH BLOCKER (see banner at top)
The server gate lives in the Next app; the flag that satisfies it is written by the
`submit-consent` **edge function**. **They must ship together, edge function first — never the
app gate alone.**

**Required order:**
1. **Deploy the `submit-consent` edge function FIRST:** `scripts/deploy-edge-function.sh submit-consent`
2. Then deploy the app (Next) with the `createSubscription`/`familyBilling` gate.

**If the app gate ships but the edge function does NOT:** every real signup keeps
`promo_attestation_confirmed=false`, so **(a)** the attestation is never recorded to
`promo_attestations` (silent audit gap) and **(b)** the affinity discount is dropped at billing
**even for someone who attested**. Fail-closed on the money, fail-silent on the record — do not
split the deploy.

## Not done here
- Edge function + app are **not deployed** (built only). Because `lib/consent.ts` posts to the
  remote `submit-consent`, the recording path can't be end-to-end tested until the function is
  deployed (or run via `supabase functions serve`).
- The live-dashboard `igy_episcopal`/`igy_hardtner` codes carry the attestation metadata (per
  Iain) and will gate the same way once IGY runs on a live key — the gate is mode-independent.
