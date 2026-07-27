# Church Outreach — Domain Auth & Go-Live Setup (needs Iain / DNS)

Everything in code is built. These steps require the Resend dashboard + DNS access and can't be
done from the app. Do them before flipping the send gate.

## 1. Authenticate the sending subdomain in Resend (SPF / DKIM / DMARC)

Send identity is `hello@outreach.itsgodyo.com` — a **dedicated subdomain**, so cold-outreach
reputation is isolated from `itsgodyo.com` (your product/transactional mail).

1. Resend → **Domains → Add Domain** → enter `outreach.itsgodyo.com` (a subdomain, not the root).
2. Resend shows the exact DNS records to add at your DNS host (GoDaddy, per project notes). They are:
   - **MX** + **TXT (SPF)** on a `send.outreach` bounce subdomain (Resend's return-path).
   - **TXT (DKIM)** — a `resend._domainkey.outreach` record with the public key.
   - **DMARC** — add `_dmarc.outreach.itsgodyo.com` TXT: start at
     `v=DMARC1; p=none; rua=mailto:dmarc@itsgodyo.com` (monitor), tighten to `p=quarantine`
     once aligned. (Values above are the shape; **use the exact strings Resend generates** —
     don't hand-copy from here.)
3. Add the records, then click **Verify** in Resend. **Do not send real volume until it shows
   Verified** — spec §8: an unauthenticated domain can send in testing and still land in spam.
4. Sanity check after verify: `dig TXT resend._domainkey.outreach.itsgodyo.com +short` returns
   the key; send a test to a Gmail address and confirm the header shows `SPF: PASS`,
   `DKIM: PASS`, `DMARC: PASS`.

## 2. Point the Resend event webhook at the app

1. Resend → **Webhooks → Add Endpoint** → `https://itsgodyo.com/api/outreach/resend-webhook`
   (or the current canonical app URL).
2. Subscribe to at least **`email.bounced`** and **`email.complained`**.
3. Copy the endpoint's **Signing Secret** (`whsec_…`) → set as `RESEND_WEBHOOK_SECRET` in Vercel.
   (Without it the webhook route returns 503 by design — it never trusts unsigned events.)

## 3. Environment variables (Vercel)

Already used by the app: `RESEND_API_KEY`, `STRIPE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`CRON_SECRET`. Add for outreach (see `.env.example` for the full annotated list):

| Var | Value |
|---|---|
| `ANTHROPIC_API_KEY` | for discovery web search (unset ⇒ discovery no-ops) |
| `RESEND_WEBHOOK_SECRET` | from step 2 |
| `OUTREACH_UNSUB_SECRET` | random 32+ char secret (or leave unset to reuse `CRON_SECRET`) |
| `OUTREACH_APP_URL` | `https://itsgodyo.com` (host that serves the unsub route) |

## 4. Verify before the gate (dry run)

```
# Dry-run send preview (mints nothing, sends nothing):
curl -H "Authorization: Bearer $CRON_SECRET" "https://itsgodyo.com/api/cron/outreach-send?dry=1"
# Discovery (only if ANTHROPIC_API_KEY set — writes leads, sends nothing):
curl -H "Authorization: Bearer $CRON_SECRET" "https://itsgodyo.com/api/cron/outreach-discovery"
```

## 5. THE SEND GATE — flip only after both sign-offs

A live send needs all three set to `true` in Vercel, per Iain's rule (copy + legal, separate
from the build):

```
OUTREACH_COPY_APPROVED=true      # after you approve the email copy
OUTREACH_LEGAL_APPROVED=true     # after legal review clears
OUTREACH_SEND_LIVE=true          # master switch
```

Recommended first live batch: set `OUTREACH_SEND_ALLOWLIST` to one or two addresses so the very
first real send is to a controlled set, confirm delivery + unsubscribe + a test conversion, then
remove the allowlist.

## Cron schedule (already in vercel.json)
- Discovery: `0 14 1 * *` (1st of month, 14:00 UTC)
- Send: `0 15 2 * *` (2nd of month, 15:00 UTC — a day after discovery)
