# Church Outreach Agent — Dry Run for Review (2026-07-27)

**This is the human-review gate from the handoff and spec §8. Nothing here has been
sent to any organization, nothing has been written to the database, and nothing has
been deployed.** This document is the discovery output + drafted emails for Iain to
review *before* any real send is green-lit.

Spec: `IGY-Church-Outreach-Agent-Spec-v1-READY-CORRECTED.md`.

---

## Decisions applied (confirmed by Iain 2026-07-27)

| Spec said | Reality in the codebase | Applied here |
|---|---|---|
| Send from `hello@igy.com` | `igy.com` isn't owned; everything uses `itsgodyo.com` | **`hello@outreach.itsgodyo.com`** — a dedicated sending subdomain, so cold-outreach reputation is isolated from the root/product domain |
| "SendGrid, already connected" | No SendGrid anywhere; email path is **Resend** (+ M365 SMTP) in `lib/sponsorInquiry.ts` | **Resend**, extending the existing setup — no second email vendor |
| Reply handling | — | `Reply-To: iaindeckard@gmail.com` — Iain reads every reply personally (§7.4) |

---

## 1. Discovery dry run — Wichita metro (Phase 1)

Per spec §6, the first automated cycle re-covers the same ground as the manual batch
(`IGY-Church-Outreach-Contacts-Wichita-Batch1.xlsx`) as a validation step. Below is the
**structured JSON** the discovery job emits (spec §4 — structured extraction with a
source per lead, not free-text scraping), followed by which entries I independently
spot-verified live today.

```json
[
  {
    "org_name": "Christ Church",
    "city": "Wichita", "state": "KS",
    "denomination_type": "Non-denominational",
    "contact_email": "admin@christpeople.church",
    "phone": "(316) 733-7011", "website": "https://christpeople.church",
    "youth_ministry_signal": "Grades 6-12 gather Wednesdays 6:00pm (Youth Room); 6th-8th Sundays 9:30am; 6th-12th Sundays 11:15am",
    "source_urls": ["https://christpeople.church/youth"],
    "discovery_confidence": "high",
    "status": "active"
  },
  {
    "org_name": "Immanuel Baptist Church",
    "city": "Wichita", "state": "KS",
    "denomination_type": "Southern Baptist",
    "contact_email": "info@ibcwichita.com",
    "phone": "(316) 262-1452", "website": "https://ibcwichita.com",
    "youth_ministry_signal": "Student Ministry grades 7-12, Sunday LifeGroups + Wednesday 6pm",
    "source_urls": ["https://ibcwichita.com/ministries", "https://ibcwichita.com/about/contact/"],
    "discovery_confidence": "high",
    "status": "active"
  },
  {
    "org_name": "Central Christian Church",
    "city": "Wichita", "state": "KS",
    "denomination_type": "Christian Church (independent)",
    "contact_email": "socialmedia@ccc.org",
    "phone": "(316) 688-4400", "website": "https://ccc.org",
    "youth_ministry_signal": "Active Youth Ministry dept, regular youth group meetings",
    "source_urls": ["https://ccc.org/youth"],
    "discovery_confidence": "medium",
    "status": "needs_review",
    "note": "Only a departmental social-media inbox (socialmedia@) was found, not a dedicated info@/office@. Per Iain (2026-07-27) this drops to needs_review — the discovery rule now routes any non-general/departmental address there automatically (lib/outreach/config.ts isGeneralAddress)."
  },
  {
    "org_name": "Wichita United Church of Christ",
    "city": "Wichita", "state": "KS",
    "denomination_type": "United Church of Christ",
    "contact_email": "admin@wichitaucc.org",
    "phone": "(316) 685-4451", "website": "https://wichitaucc.org",
    "youth_ministry_signal": "Youth Groups ages 11-16, confirmation program",
    "source_urls": ["https://wichitaucc.org/youth-groups"],
    "discovery_confidence": "medium",
    "status": "active"
  },
  {
    "org_name": "Westwood Presbyterian Church",
    "city": "Wichita", "state": "KS",
    "denomination_type": "Presbyterian (PC-USA)",
    "contact_email": "admin@westwoodpc.org",
    "phone": "(316) 722-3753", "website": "https://westwoodpc.org",
    "youth_ministry_signal": "Weekly Wednesday 7pm youth group",
    "source_urls": ["https://www.westwoodpc.org/"],
    "discovery_confidence": "medium",
    "status": "active"
  },
  {
    "org_name": "Pathway Church",
    "city": "Wichita", "state": "KS",
    "denomination_type": "Non-denominational",
    "contact_email": "info@pathwaychurch.com",
    "phone": "(316) 722-8020", "website": "https://pathwaychurch.com",
    "youth_ministry_signal": "Students program grades 6-12 (multi-campus: Wichita / Goddard / Valley Center)",
    "source_urls": ["https://pathwaychurch.com/students (search-indexed snippet — direct fetch returned HTTP 403)"],
    "discovery_confidence": "medium",
    "status": "active",
    "note": "Site blocks automated fetch (403). Per §4 guardrail the job did NOT force it — relied on the search-indexed snippet only, same as the manual batch did for newlifecovenant.org."
  },
  {
    "org_name": "Calvary Baptist Church",
    "city": "Derby", "state": "KS",
    "denomination_type": "Baptist",
    "contact_email": "office@cbcks.org",
    "phone": "(316) 788-0864", "website": "https://cbcks.org",
    "youth_ministry_signal": "Teens Sunday School class; listed Youth Horizons church partner (~10 mi S of Wichita)",
    "source_urls": ["https://cbcks.org"],
    "discovery_confidence": "medium",
    "status": "active"
  },
  {
    "org_name": "St. Cecilia Catholic Church",
    "city": "Haysville", "state": "KS",
    "denomination_type": "Roman Catholic",
    "contact_email": "church@stceciliahaysville.org",
    "phone": "(316) 524-7801", "website": "https://stceciliahaysville.org",
    "youth_ministry_signal": "Diocesan Faith Formation / youth ministry program — parish-level ACTIVITY NOT INDEPENDENTLY CONFIRMED",
    "source_urls": ["https://stceciliahaysville.org"],
    "discovery_confidence": "low",
    "status": "needs_review",
    "note": "Held out of sends. Weak/stale youth-ministry signal — exactly the honesty case in spec §3. A human confirms before it ever becomes 'active'."
  }
]
```

### Verification I ran today (live, like a human spot-check)

- **Christ Church** — fetched `/youth`: youth ministry text and `admin@christpeople.church` both confirmed live. ✅
- **Immanuel Baptist** — fetched `/ministries`: grades 7-12 Sun+Wed 6pm confirmed. The **email is not on that page** — `info@ibcwichita.com` is sourced from the contact page (`/about/contact/`). This is a real lesson for the job: **each fact (email vs youth signal) must cite its own source URL**, not share one. ✅
- **Pathway Church** — direct fetch **blocked (HTTP 403)**. Correctly *not* forced; snippet-sourced only. This is the robots/blocked-site guardrail working in practice. ⚠️
- The remaining 4 (Central Christian, Wichita UCC, Westwood, Calvary Baptist) are carried from the manual batch research and marked `medium` pending the same per-fact live re-verification the real job will do on its first run.

### Resulting pipeline state
- **6 → `active`** (would be sent to, each with its own minted 10%-off code)
- **2 → `needs_review`** (St. Cecilia — weak youth signal; Central Christian — departmental email only. Both held for human confirmation)
- **0 → sent** (this is a dry run)

---

## 2. The outreach email (LOCKED / APPROVED 2026-07-28)

> Copy below matches `IGY-Church-Outreach-Email-Copy-APPROVED-2026-07-28.md` (Iain's
> final, locked version) and the templates in `lib/outreach/email.ts`. Approval of the
> copy does **not** open the send gate — `OUTREACH_LEGAL_APPROVED` and `OUTREACH_SEND_LIVE`
> remain unset, so nothing sends.

Every send carries the CAN-SPAM / RFC 8058 baseline from spec §2. **SMTP-level headers**
the send job sets:

```
From: It's God, Yo <hello@outreach.itsgodyo.com>
Reply-To: iaindeckard@gmail.com
List-Unsubscribe: <{{UNSUB_URL}}>, <mailto:unsubscribe@outreach.itsgodyo.com?subject=unsub-{{LEAD_ID}}>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

`{{UNSUB_URL}}` is a one-click link that hits a public unsubscribe route → flips the lead
to `unsubscribed` in real time (permanent, never re-added on rediscovery) and pushes the
address to Resend's Suppressions list. Hard bounces from Resend's webhook do the same →
`bounced_hard`.

**Subject** (honest, clearly outreach — not deceptive):
> A partnership opportunity for {{ORG_NAME}}'s youth ministry

**Body:**

> Hi {{ORG_NAME}} team,
>
> I'm Iain, founder of **It's God, Yo!**, a daily Scripture text devotional built for
> teens, in English (KJV) and Spanish (Reina-Valera 1909). One verse a day, rewritten in
> their language, real slang they use today so they actually understand it. There's always
> a link back to the full KJV text too. And thanks to a proprietary system, the slang is
> never stale.
>
> {{ORG_NAME}} has an active youth ministry, and I thought this might be useful for the
> students you're already working with. Here's a code for **10% off** any plan, on us:
>
> > **{{PROMO_CODE}}** — 10% off at https://itsgodyo.com
>
> No pressure here. Share it if it's a fit, ignore it if it's not. If you'd rather not hear
> from us again, the link below removes {{ORG_NAME}} for good.
>
> Thanks for helping us get the Word of God to young people every day.
>
> **Iain Deckard** · It's God, Yo!
> Reply to this email directly, it comes to me.

**Footer** (physical address is legally required — pulled from IGY's own ToS/privacy footer):

> It's God, Yo!™ is operated by Deckard Enterprise International, LLC · 2221 N Amarado St,
> Wichita, KS 67205.
> You received this because {{ORG_NAME}} is a Wichita-area church with a publicly listed
> youth ministry. We're proud to say we're local too. We found your general contact address
> at {{SOURCE_NOTE}}. Please, help support a local small business!
> **Unsubscribe (one click)** → {{UNSUB_URL}}

### Rendered example — Christ Church (would send)
- **To:** admin@christpeople.church
- **Subject:** A partnership opportunity for Christ Church's youth ministry
- **{{PROMO_CODE}}:** `IGY-CHRISTCHURCH-<minted at first send>` (unique per lead, 10% off, via `lib/promoCodes.ts`)
- **{{SOURCE_NOTE}}:** christpeople.church/youth

### Rendered example — St. Cecilia (would NOT send)
- Status `needs_review`; held out of the send entirely until a human confirms the youth signal.

---

## 3. Data-quality flags found during the dry run

1. **Central Christian's only public address is `socialmedia@ccc.org`** — a departmental
   social inbox, not a dedicated `info@`/`office@`. **Resolved (Iain, 2026-07-27): drop to
   `needs_review`.** Encoded as a general rule — `lib/outreach/config.ts` `isGeneralAddress()`
   only accepts recognized general prefixes (info/office/church/admin/…); anything else
   (like `socialmedia@`) lands in `needs_review` automatically at discovery time.
2. **Per-fact sourcing** — Immanuel proved the email and the youth signal can live on
   different pages. The discovery schema already separates them (`source_urls` is an array);
   the job's prompt must require a source for *each* claim, not one shared URL.
3. **Blocked sites are real and common** — Pathway (403) and, per the spec, newlifecovenant.org.
   The job must degrade to search snippets, never force a fetch, and mark those leads a notch
   lower in confidence.

---

## 4. Build status — COMPLETE (send stays gated until you sign off)

Per Iain's go-ahead (2026-07-27), the full pipeline is now built. **It cannot send to a real
org until you set two approval flags** (email copy + legal), so today it only does dry runs.

**Built & applied:**
- `supabase/migrations/20260727000001_outreach_leads.sql` — `igy_outreach_leads` table,
  **applied** to `bkwtlfkhfbfyzgnozixw` (verified: 25 cols, RLS on, unique-email suppression
  index, `marketing.outreach.*` RBAC). Migration history reconciled.
- **Discovery** — `lib/outreach/discovery.ts` + `/api/cron/outreach-discovery` (monthly Vercel
  Cron). Claude API + web search, guardrails baked into the prompt, structured JSON → upsert
  that never resurrects a suppressed org. No-ops safely if `ANTHROPIC_API_KEY` is unset.
- **Send** — `lib/outreach/run.ts` + `/api/cron/outreach-send` (monthly). Per-lead 10% promo via
  `lib/promoCodes.ts`, Resend send with List-Unsubscribe headers, `send_count`, age-out at 6.
  **Dry-run by default** (see gate below).
- **One-click unsubscribe** — `/api/outreach/unsubscribe` (HMAC-token GET + RFC 8058 POST),
  real-time permanent suppression.
- **Bounce/complaint webhook** — `/api/outreach/resend-webhook` (Svix-verified): hard bounce →
  `bounced_hard`, complaint → `unsubscribed`.
- **Stripe conversion** — added to `app/api/stripe/webhook/route.ts`: on the first real charge,
  matches the signup's `promo_promotion_code_id` to an outreach lead → `converted`. Additive to
  and independent of the referral path (both fire under the same guard; outreach no-ops when no
  outreach code was used).

**The send gate (your two sign-offs):** a LIVE send requires all three env flags = `true` —
`OUTREACH_COPY_APPROVED` (you approve this email copy), `OUTREACH_LEGAL_APPROVED` (legal clears),
`OUTREACH_SEND_LIVE` (master switch). Until then every run is a dry run that mints nothing and
sends nothing. There is no request parameter that can force a live send.

**Still needs you / DNS (can't be done from code):** `outreach.itsgodyo.com` domain
authentication in Resend (SPF/DKIM/DMARC records added to DNS and verified — must actually pass
before volume, spec §8), and the Resend event webhook pointed at `/api/outreach/resend-webhook`.
Exact steps in `docs/church-outreach-domain-setup.md`.
