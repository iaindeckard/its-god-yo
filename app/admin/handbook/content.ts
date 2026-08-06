// IGY Employee Manual — "How IGY Actually Works"
//
// Structured content for the in-admin employee handbook (/admin/handbook).
// Built 2026-08-03 from IGY-Employee-Manual-Spec-v2.md (Drive), with every
// [CC: VERIFY] section checked against the live codebase / Stripe / Supabase
// before publishing.
//
// SINGLE SOURCE OF TRUTH for the handbook text. Editing here updates the page.
//
// This file is customer-/staff-facing rendered copy and IS enforced by the dash
// policy (scripts/lint-dashes.mjs) and the ™ convention — no em/en-dash sentence
// connectors, ™ at first prominent mention only.
//
// Locked sections (do not add to / do not invent): Part 6 (Policies & Escalation)
// and Part 7 (Common Questions) are reproduced as-written per Iain's direction
// 2026-08-02. Do NOT document the Holy Season add-ons (Christmastide/Advent/
// Eastertide/Lent) — spec'd but unbuilt; documenting them would repeat the exact
// failure mode Part 7 warns against.

export type Block =
  | { type: "prose"; text: string }
  | { type: "subheading"; text: string }
  | { type: "list"; items: string[]; ordered?: boolean }
  | { type: "table"; head: string[]; rows: string[][] }
  | { type: "callout"; kind: CalloutKind; title?: string; text: string };

export type CalloutKind =
  | "info" // Heads up / good-to-know (blue)
  | "tip" // Practical tip (blue, lighter)
  | "warning" // Known issue / be careful (gold)
  | "danger" // Never say / hard rule (red)
  | "escalate"; // Always escalate immediately (red, emphatic)

export interface Entry {
  id: string; // anchor slug, unique across the whole book
  title: string;
  kicker?: string; // small label above the title
  address?: string; // the real URL/path this screen lives at, if any
  relatedRoute?: string; // admin route this entry documents — drives role-gating
  blocks: Block[];
}

export interface Part {
  id: string;
  number?: string; // "1".."7"
  title: string;
  blurb?: string;
  entries: Entry[];
}

export const HANDBOOK_UPDATED = "August 3, 2026";

export const PARTS: Part[] = [
  // ------------------------------------------------------------------ START HERE
  {
    id: "start-here",
    title: "Start Here",
    blurb: "How to use this book, and the company context that frames everything else.",
    entries: [
      {
        id: "how-to-use",
        title: "How to use this manual",
        kicker: "Start here",
        blocks: [
          { type: "prose", text: "This is the employee-only reference for It's God, Yo!™ (IGY™). It's meant to sit next to the screens it documents, not drift in a file somewhere. You don't have to read it front to back. Use the search box at the top or the navigation to jump straight to whatever you're dealing with right now." },
          { type: "subheading", text: "What's in here" },
          { type: "list", items: [
            "Part 1, Welcome & Mission: what IGY is and how we carry ourselves.",
            "Part 2, The Product: plans, pricing, the DM from Him add-on, and how a daily verse actually reaches a subscriber.",
            "Part 3, Programs: the Cornerstone Partner Program and the affinity promo codes.",
            "Part 4, How We Operate: deploy discipline, the DEI financial rollup, and the flags that gate live billing.",
            "Part 5, Admin Panel Walkthrough: every internal /admin screen, what it does, and the permission it checks. You only see the sections your role can access.",
            "Part 6, Policies & Escalation: the four scenarios that matter and exactly who to contact.",
            "Part 7, Common Questions: intentionally empty for now (see the note there).",
          ] },
          { type: "callout", kind: "info", title: "Role-gated by design", text: "Part 5's admin-screen write-ups are filtered to the same permission the real screen checks. If a section is missing from your view, it's limited to another role, not deleted. The count of hidden sections is shown at the top." },
        ],
      },
      {
        id: "company-context",
        title: "Company context: DEI and IGY",
        kicker: "Start here",
        blocks: [
          { type: "prose", text: "IGY is a product of Deckard Enterprise International, LLC (DEI), a holding company that operates several ventures. DEI handles licensing, overhead, and revenue-share; each venture pays DEI a cut." },
          { type: "callout", kind: "warning", title: "Its own isolated infrastructure", text: "IGY runs on its own Supabase project, its own Stripe account, and its own codebase. Don't assume it shares logins, data, or Stripe/Supabase access with any other DEI venture; it doesn't." },
        ],
      },
    ],
  },

  // ------------------------------------------------------------------ PART 1
  {
    id: "welcome-mission",
    number: "1",
    title: "Welcome & Mission",
    blurb: "What we're building, who it's for, and the one value we don't compromise on.",
    entries: [
      {
        id: "what-igy-is",
        title: "What IGY is",
        blocks: [
          { type: "prose", text: "IGY is a faith-based subscription service that sends teenagers a daily Bible-based message by SMS. The tagline is “Faith that fits in a text.”" },
          { type: "subheading", text: "The value we don't compromise on" },
          { type: "prose", text: "Full transparency to customers about how the product actually works. Nothing is hidden about pricing, about what's AI-generated, or about how content is selected. When in doubt, tell the truth plainly. That's the brand." },
          { type: "subheading", text: "Who it's for" },
          { type: "prose", text: "Two audiences at once: the parent or guardian who signs up and pays, and the teen who actually receives the messages. The landing page reflects this with a dual-audience gate: a parent card and a teen card, so each sees copy written for them." },
          { type: "subheading", text: "Where IGY sits under DEI" },
          { type: "prose", text: "IGY operates under DEI and shares its operating discipline, but runs as a completely separate product with its own market and infrastructure. Treat it as its own system." },
        ],
      },
    ],
  },

  // ------------------------------------------------------------------ PART 2
  {
    id: "the-product",
    number: "2",
    title: "The Product",
    blurb: "Plans, the DM from Him add-on, how delivery works, and the trust & safety patterns you should know before answering anyone.",
    entries: [
      {
        id: "plans-pricing",
        title: "Plans & pricing",
        blocks: [
          { type: "prose", text: "Every plan below is verified against the live plan catalog (lib/plans.ts, the single source the signup flow reads). Prices reference the live Stripe price IDs in production." },
          { type: "table", head: ["Plan", "Price", "Notes"], rows: [
            ["Individual (monthly)", "$6.99 / month", "One teen, billed monthly."],
            ["Individual (annual)", "$59.00 / year", "One teen, billed once a year."],
            ["Family", "$99.00 / year", "Base covers up to 2 teens; each additional teen is $28.00/year, added at that teen's own trial-end."],
            ["Gift", "$59.00 / year", "One teen, purchased for someone else."],
            ["Group / church", "$28 to $36 per teen / year", "Per-teen quantity in bands: 1–50 = $28, 51–150 = $32, 151–300 = $36. 301+ is contact-us (no self-serve price)."],
          ] },
          { type: "callout", kind: "info", title: "Verified 2026-08-03", text: "Pricing above matches lib/plans.ts exactly. If anyone quotes an older figure (e.g. a $1.99 DM add-on), it's stale. The current numbers are here." },
        ],
      },
      {
        id: "dm-from-him",
        title: "DM from Him (add-on)",
        blocks: [
          { type: "prose", text: "DM from Him is an optional add-on, not a separate product. It re-wraps the subscriber's SAME daily verse in first-person, personal framing, like a note written directly to them. It is not extra or different content." },
          { type: "table", head: ["", "Price", "Detail"], rows: [
            ["Monthly", "$2.99 / month", "Matches a monthly base plan (Individual monthly)."],
            ["Annual", "$35.88 / year", "= 12 × $2.99. Matches every annual base plan (annual / family / gift / group)."],
          ] },
          { type: "list", items: [
            "Priced per teen; the add-on's billing interval must match the base plan's interval (Stripe rejects mixed intervals in one subscription).",
            "Sends NO extra text: zero incremental SMS volume. It changes how the one daily verse reads, not how many messages go out.",
            "Toggled by SMS keyword: DM ON turns it on, DM OFF turns it off. STOP cancels the whole subscription, including the add-on.",
          ] },
        ],
      },
      {
        id: "how-delivery-works",
        title: "How delivery actually works",
        blocks: [
          { type: "list", ordered: true, items: [
            "Signup collects consent: age-gated, country-aware, and fail-closed by design.",
            "An SMS “YES” confirmation is required before any subscription activates. No YES, no activation, no charge.",
            "Once confirmed, the subscriber gets one daily verse by SMS at their scheduled send time.",
          ] },
          { type: "prose", text: "Content itself passes through a review pipeline first: verses run through an eligibility/sentence-completeness filter and a needs_review flag before they enter the live send pool. Nothing untested reaches subscribers." },
          { type: "callout", kind: "danger", title: "Spanish is NOT live", text: "Spanish is built but gated off (SPANISH_ENABLED=false) pending a full native-fluent review pass. Do not tell customers Spanish is available." },
        ],
      },
      {
        id: "trust-safety",
        title: "Trust & safety patterns worth knowing",
        blocks: [
          { type: "callout", kind: "danger", title: "The age-consent gate fails closed", text: "In any country without an attorney-confirmed self-consent threshold, the age-consent architecture blocks by default. This is deliberate. Never work around it for convenience or under customer pressure." },
          { type: "prose", text: "/its-okay-to-not-be-okay is a standing safety-resources page. Know it exists and what it's for before you field any support message that touches on a subscriber's wellbeing. See Part 6 for the escalation rule when a message suggests someone may be at risk." },
        ],
      },
    ],
  },

  // ------------------------------------------------------------------ PART 3
  {
    id: "programs",
    number: "3",
    title: "Programs",
    blurb: "Cornerstone (live) and the affinity promo codes.",
    entries: [
      {
        id: "cornerstone-program",
        title: "Cornerstone Partner Program™ (live)",
        blocks: [
          { type: "prose", text: "Cornerstone recognizes churches that join during IGY's early growth stage. Each partner receives:" },
          { type: "list", items: [
            "A permanent, sequential, never-reused Cornerstone Partner number.",
            "Locked-in pricing.",
            "A downloadable certificate and badge.",
            "An opt-in listing on the public /cornerstone-partners directory, including an interactive 3D atlas-style globe showing partner locations.",
          ] },
          { type: "callout", kind: "warning", title: "Manual approval only", text: "The program launches in manual-approval mode: every application is reviewed by a human at /admin/cornerstone before approval. Nothing auto-approves." },
          { type: "prose", text: "IGY has no customer login system. Churches access their own status through a tokenized link, not an account." },
        ],
      },
      {
        id: "promo-codes",
        title: "Affinity / promo codes",
        blocks: [
          { type: "prose", text: "Two affinity codes are active in live Stripe, tied to warm relationships that also feed the Cornerstone pipeline. Both are attestation-gated: the purchaser must confirm they qualify. Verified active in Stripe 2026-08-03." },
          { type: "table", head: ["Code", "Discount", "Who it's for", "Status"], rows: [
            ["igy_episcopal", "15% off", "Members of the Episcopal Church (attestation required)", "Active · first-time purchase · one-time discount"],
            ["igy_hardtner", "10% off", "Camp Hardtner attendees / their caregivers (attestation required)", "Active · one-time discount"],
          ] },
          { type: "callout", kind: "info", title: "Created in Stripe, managed in-app", text: "These were created directly in the Stripe dashboard. Promo codes are also viewable/manageable in the admin Promo Code Studio (see Part 5) for staff with billing permissions." },
        ],
      },
    ],
  },

  // ------------------------------------------------------------------ PART 4
  {
    id: "how-we-operate",
    number: "4",
    title: "How We Operate",
    blurb: "The operational realities behind releases, reporting, and the flags that decide what a real customer can be charged for.",
    entries: [
      {
        id: "deploy-discipline",
        title: "Deploy discipline",
        blocks: [
          { type: "callout", kind: "danger", title: "A git push does NOT ship IGY", text: "IGY does NOT auto-deploy on git push. A push only records the commit; someone has to run `vercel --prod --yes` to actually ship it. If you skip this, you'll think something shipped when it didn't." },
        ],
      },
      {
        id: "dei-rollup",
        title: "DEI financial rollup",
        blocks: [
          { type: "prose", text: "IGY reports into a separate DEI-owned Supabase project via a nightly batch ETL. DEI never live-queries IGY's database directly. The flow is read-only, one-way, and runs on a cron." },
        ],
      },
      {
        id: "purchases-enabled",
        title: "PURCHASES_ENABLED: the billing kill-switch",
        blocks: [
          { type: "prose", text: "PURCHASES_ENABLED is the master flag gating all live billing. Anyone touching pricing, Stripe, or the signup flow should check its current state before assuming anything is chargeable to a real customer." },
          { type: "callout", kind: "warning", title: "Current value: false (verified 2026-08-03)", text: "PURCHASES_ENABLED is currently false. While false, /signup shows a “coming soon” notice and /api/setup-intent refuses to create a SetupIntent, so no card can be entered and no one can be charged." },
        ],
      },
    ],
  },

  // ------------------------------------------------------------------ PART 5 (role-gated by relatedRoute)
  {
    id: "admin-panel",
    number: "5",
    title: "Admin Panel Walkthrough",
    blurb: "Every internal /admin screen, what it does, and the permission it checks. You only see the write-ups your role can access.",
    entries: [
      {
        id: "admin-cornerstone",
        title: "Cornerstone Partners",
        address: "/admin/cornerstone",
        relatedRoute: "/admin/cornerstone",
        blocks: [
          { type: "prose", text: "The human-review console for the Cornerstone Partner Program. Every church application lands here and is approved or declined by a person. Nothing auto-approves." },
          { type: "list", items: [
            "Review incoming applications; approve or decline (partners.review).",
            "Manage partner records, locked-in pricing, and program config (partners.manage).",
            "Recover a church's tokenized status link if they lose it (resend-link recovery).",
          ] },
          { type: "callout", kind: "info", title: "Permission: partners.view", text: "Viewing this screen requires partners.view. Approving/declining requires partners.review; editing records/pricing/config requires partners.manage. All three are currently super_admin only." },
        ],
      },
      {
        id: "admin-review",
        title: "Review Queue",
        address: "/admin/review",
        relatedRoute: "/admin/review",
        blocks: [
          { type: "prose", text: "Where daily-verse content is approved before it can reach subscribers. It's the human gate on the content pipeline." },
          { type: "list", items: [
            "View flagged verse/translation slots (content.queue.view).",
            "Approve a translation (content.queue.approve).",
            "Reject/edit a translation, or reject a verse entirely to trigger re-selection (content.queue.reject_translation / reject_verse).",
            "Super admins can force-resolve a stuck or escalated slot (content.queue.force_resolve).",
          ] },
          { type: "callout", kind: "info", title: "Permission: content.queue.view", text: "Open to content_reviewer and super_admin." },
        ],
      },
      {
        id: "admin-theme-tags",
        title: "Theme Tags",
        address: "/admin/theme-tags",
        relatedRoute: "/admin/theme-tags",
        blocks: [
          { type: "prose", text: "Review of proposed theme/mood tags on verses, which power themed send tracks." },
          { type: "list", items: [
            "View proposed theme/mood verse tags (content.theme_tags.view).",
            "Approve or reject tags (content.theme_tags.review).",
          ] },
          { type: "callout", kind: "info", title: "Permission: content.theme_tags.view", text: "Open to content_reviewer and super_admin." },
        ],
      },
      {
        id: "admin-bounty",
        title: "Error Bounty",
        address: "/admin/bounty",
        relatedRoute: "/admin/bounty",
        blocks: [
          { type: "prose", text: "The error-bounty workflow: subscriber-reported content errors, their review, and the credit ledger." },
          { type: "list", items: [
            "View reports and the credit ledger (finance.bounty.view).",
            "Confirm or reject reports (finance.bounty.review).",
            "Publish/revert an accepted correction to live daily content, and apply an earned credit (content.queue.publish / finance.bounty.apply, super_admin).",
          ] },
          { type: "callout", kind: "info", title: "Permission: finance.bounty.view", text: "View/review open to content_reviewer and super_admin; publishing corrections and applying credits are super_admin only." },
        ],
      },
      {
        id: "admin-promo-codes",
        title: "Promo Code Studio",
        address: "/admin/promo-codes",
        relatedRoute: "/admin/promo-codes",
        blocks: [
          { type: "prose", text: "Create and manage Stripe-native discount codes (including the affinity codes in Part 3)." },
          { type: "list", items: [
            "View promo codes (billing.promo_codes.view).",
            "Create, edit, and deactivate codes (billing.promo_codes.create / edit / deactivate).",
          ] },
          { type: "callout", kind: "info", title: "Permission: billing.promo_codes.view (super_admin)", text: "All promo-code permissions are currently super_admin only." },
        ],
      },
      {
        id: "admin-referrals",
        title: "Referrals",
        address: "/admin/referrals",
        relatedRoute: "/admin/referrals",
        blocks: [
          { type: "prose", text: "The give/get-a-month referral loop: referral events, rewards, and the reward cap. Referrals reward via a customer-balance credit at the referee's paid conversion (the old 10%-off referral coupon was retired 2026-07-24)." },
          { type: "callout", kind: "info", title: "Permission: billing.promo_codes.view (super_admin)", text: "Gated by the same billing permission as Promo Code Studio." },
        ],
      },
      {
        id: "admin-dashboard",
        title: "KPI Dashboard",
        address: "/admin/dashboard",
        relatedRoute: "/admin/dashboard",
        blocks: [
          { type: "prose", text: "Subscriber, MRR, funnel, and backlog metrics for the business." },
          { type: "callout", kind: "info", title: "Permission: analytics.dashboard.view (super_admin)", text: "Revenue/ARR-impact figures are further gated by analytics.revenue.view." },
        ],
      },
      {
        id: "admin-donation-fund",
        title: "Donation Fund",
        address: "/admin/donation-fund",
        relatedRoute: "/admin/donation-fund",
        blocks: [
          { type: "prose", text: "The donation-fund ledger and balance, plus disbursement recording. IGY tithes a share of net profit into this fund." },
          { type: "list", items: [
            "View the ledger and balance (finance.donation_fund.view).",
            "Record a disbursement (finance.donation_fund.disburse).",
          ] },
          { type: "callout", kind: "info", title: "Permission: finance.donation_fund.view (super_admin)", text: "Both view and disburse are currently super_admin only." },
        ],
      },
      {
        id: "admin-consent-thresholds",
        title: "Consent Thresholds",
        address: "/admin/consent-thresholds",
        relatedRoute: "/admin/consent-thresholds",
        blocks: [
          { type: "prose", text: "Per-country age-consent rules. Until a country's threshold is attorney-confirmed here, the age-consent gate fails closed for that country (see Part 2)." },
          { type: "callout", kind: "danger", title: "Permission: admin.consent_thresholds.manage (super_admin)", text: "This screen controls a legal-safety gate. Only change a country's threshold on confirmed legal guidance, never to unblock a specific signup." },
        ],
      },
    ],
  },

  // ------------------------------------------------------------------ PART 6 (LOCKED as-written)
  {
    id: "policies-escalation",
    number: "6",
    title: "Policies & Escalation",
    blurb: "Locked 2026-08-02. Four scenarios, four answers, plus what never to do.",
    entries: [
      {
        id: "escalation-scenarios",
        title: "The four escalation scenarios",
        blocks: [
          { type: "callout", kind: "escalate", title: "1 · Customer safety concern", text: "If something in a support message suggests a subscriber may be at risk, escalate to Iain directly, immediately. This is the one category treated as urgent-response, no exceptions." },
          { type: "prose", text: "2 · Billing dispute: routes through Stripe's built-in dispute/chargeback handling. This is not a manual, Iain-handles-every-case process; let Stripe's mechanism run." },
          { type: "prose", text: "3 · Data/privacy request: someone asking what data IGY holds on them, or asking for deletion. Email to support@itsgodyo.com." },
          { type: "callout", kind: "escalate", title: "4 · Security incident", text: "Breach, leaked credential, and the like: escalate to Iain directly, immediately. Same urgency tier as a customer safety concern." },
        ],
      },
      {
        id: "what-not-to-do",
        title: "What NOT to do (any scenario)",
        blocks: [
          { type: "list", items: [
            "Don't discuss unreleased features (like Spanish) as if they're live.",
            "Don't bypass the age-consent gate under any pressure, including an urgent customer request.",
            "Don't hand-edit live scripture content outside the reviewed pipeline.",
          ] },
        ],
      },
    ],
  },

  // ------------------------------------------------------------------ PART 7 (LOCKED — intentionally empty)
  {
    id: "common-questions",
    number: "7",
    title: "Common Questions",
    blurb: "Pinned 2026-08-02, deliberately not filled in.",
    entries: [
      {
        id: "cq-empty",
        title: "Why this section is empty",
        blocks: [
          { type: "prose", text: "IGY has no meaningful subscriber/church support volume yet to draw real questions from. Inventing plausible-sounding FAQs here would be fiction presented as documentation, exactly the failure mode this manual is trying to avoid everywhere else." },
          { type: "callout", kind: "warning", title: "Do not populate with speculative Q&As", text: "Revisit once there's real support history to draw from. A handful of genuinely repeated questions is the trigger to unpin this, not a calendar date." },
        ],
      },
    ],
  },

  // ------------------------------------------------------------------ GLOSSARY
  {
    id: "glossary",
    title: "Glossary",
    blurb: "The terms you'll hear most.",
    entries: [
      {
        id: "glossary-terms",
        title: "Terms",
        blocks: [
          { type: "table", head: ["Term", "Meaning"], rows: [
            ["DEI", "Deckard Enterprise International, LLC, the parent holding company."],
            ["IGY", "“It's God, Yo!”, the product this manual covers."],
            ["Cornerstone Partner", "A church recognized under the Cornerstone Partner Program; has a permanent partner number."],
            ["DM from Him", "The personalized-framing add-on to the daily verse."],
            ["PURCHASES_ENABLED", "Flag gating whether IGY can actually bill anyone (currently false)."],
            ["CORNERSTONE_ENABLED", "Flag gating the Cornerstone program's public surfaces (currently true)."],
          ] },
        ],
      },
    ],
  },
];
