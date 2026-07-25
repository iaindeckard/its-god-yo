# Toll-Free Verification (TFV) — submission draft

> **STATUS: DRAFT — NOT SUBMITTED.** For Iain's review. Nothing has been sent to
> Twilio. Fields marked **[NEEDS INPUT]** require info I don't have in the repo.
> Sources are cited so every claim is traceable to the product.

## Business / brand info

| Field | Value | Source |
|---|---|---|
| Legal business name | **Deckard Enterprise International, LLC** (a Kansas LLC) | `app/privacy/page.tsx:14` |
| Business website | **https://itsgodyo.com** | canonical domain (OG metadata) |
| Business type | Private / for-profit LLC | privacy page |
| Business address | **[NEEDS INPUT]** — registered Kansas address | — |
| Contact name / title | **[NEEDS INPUT]** — authorized rep | — |
| Contact email | **[NEEDS INPUT]** — support/business email | — |
| Contact phone | **[NEEDS INPUT]** | — |

## Use case

- **Use case category:** Notifications / Subscription content (a recurring,
  recipient-initiated content subscription — NOT marketing/promotional, NOT bulk).
- **Use case summary (UseCaseSummary):**

  > It's God, Yo! is a paid daily-scripture SMS subscription. After a purchaser
  > signs up on itsgodyo.com, the intended recipient receives a single
  > confirmation text and must personally reply YES before any messages begin or
  > any charge is made. Confirmed subscribers then receive one short daily
  > scripture message (English or Spanish) until they reply STOP. Volume is one
  > scheduled message per subscriber per day plus the one-time confirmation text.
  > This is subscription content delivery to individuals who have double-opted-in;
  > it is not promotional, marketing, or bulk messaging.

## Production message samples (ProductionMessageSample)

**Sample 1 — opt-in confirmation text (exact production copy):**
> Hey Maria! Someone who cares about you thought you could use some Good News
> every day. Reply YES to get daily texts from It's God, Yo! Msg & data rates may
> apply. Reply STOP to cancel, HELP for help.

_Source: `supabase/functions/submit-consent/index.ts:60` (English confirmation template)._

**Sample 2 — representative daily scripture message:**
> It's God, Yo! 🙏 "Come to me, all who are weary, and I'll give you rest."
> — Matthew 11:28. Whatever you're carrying today, you don't have to white-knuckle
> it alone. Reply STOP to opt out.

_Representative of the brand voice described at `lib/i18n.ts:34` ("Scripture,
rendered as short casual messages that sound like a friend") — confirm exact
production wording before submit._

**Sample 3 — HELP reply (exact production copy):**
> It's God, Yo! sends daily encouragement texts. Reply YES to confirm, STOP to
> cancel. Msg & data rates may apply.

_Source: `lib/twilioInbound.ts:27`._

## Opt-in (the section TFV reviewers weigh most heavily)

- **Opt-in type (OptInType):** WEB_FORM, followed by an explicit SMS double-opt-in
  (recipient must reply YES).
- **Opt-in workflow description:**

  > Consent is collected in two independent steps. (1) On itsgodyo.com a purchaser
  > completes a signup form that displays versioned disclosure text explaining that
  > the recipient will receive a confirmation text and that message/data rates
  > apply. (2) The recipient themselves receives a confirmation SMS and must reply
  > YES from their own device before any subscription is created or any charge
  > occurs. No recipient is ever messaged beyond that single confirmation text
  > unless they personally opt in. Replying STOP opts out at any time; HELP returns
  > help text. Consent records (disclosure text + version, timestamp, the
  > recipient's own reply, and opt-out events) are retained for at least 4 years.

  _Sources: `submit-consent/index.ts` (double opt-in + versioned consent),
  `lib/twilioInbound.ts` (YES/STOP/HELP handling), `app/privacy/page.tsx:41`
  (consent & opt-out), `app/privacy/page.tsx:46` (4-year retention)._

- **Opt-in evidence URL(s):** **[NEEDS INPUT]** — a *public* (no-login) URL showing
  the signup form + disclosure text. TFV rejects inaccessible opt-in URLs (error
  30509). If the form isn't crawlable, host screenshots at a public URL.
- **Privacy policy URL:** https://itsgodyo.com/privacy (public) — `app/privacy/page.tsx`
- **Terms URL:** https://itsgodyo.com/terms (public) — `app/terms/page.tsx`

## Volume

- **Estimated monthly volume:** **[NEEDS INPUT — pick the realistic near-term
  subscriber count].** Working estimate: ~500–2,000 subscribers × ~1 msg/day ≈
  **15,000–60,000 segments/month**. Select the TFV volume bracket at or just above
  the realistic figure — do **not** over-request (TFV rejects volume that looks
  disproportionate to business size, error 30495).

## Number

- **[NEEDS CONFIRMATION from Console]** whether a toll-free number is already
  purchased. TFV requires a toll-free number (8xx); a local 10DLC number cannot be
  converted. If none exists, buy one toll-free number first (no code change needed
  — the send path uses a bare `From`, no Messaging Service required for toll-free).

## Open items before submit
1. Business address, contact name/title/email/phone.
2. Public opt-in evidence URL (or hosted screenshots).
3. Confirm/lock the exact daily-message wording for Sample 2.
4. Pin the realistic monthly volume bracket.
5. Confirm whether a toll-free number already exists in the account.
