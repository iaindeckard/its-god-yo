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
// 2026-08-02. The Holy Season add-ons (Christmastide/Advent/Eastertide/Lent) are
// now BUILT but flag-gated OFF (SEASONS_ENABLED=false): document the internal
// /admin/season-review screen and the built-but-dormant status, but do NOT present
// seasons as a live customer offering until the flag flips.

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

export const HANDBOOK_UPDATED = "August 8, 2026";

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
          { type: "callout", kind: "danger", title: "A push to main ships IGY live", text: "IGY auto-deploys from git: a commit pushed to main goes to production on its own, usually within about a minute. A push to main IS a live release, so don't push to main unless you mean to ship. Running `vercel --prod --yes` still works as a manual deploy; if you use it, confirm afterward which deployment holds the itsgodyo.com production alias." },
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
          { type: "prose", text: "PURCHASES_ENABLED is the master flag gating all live billing. Anyone touching pricing, Stripe, or the signup flow should check its current state before assuming anything about what a real customer can be charged." },
          { type: "callout", kind: "warning", title: "Current value: true (live since 2026-08-04)", text: "PURCHASES_ENABLED is currently true. IGY is live: /signup runs the real purchase flow and /api/setup-intent creates SetupIntents, so real cards can be entered and real customers can be charged. If it is ever flipped back to false, /signup shows a “coming soon” notice and no one can be charged. Always check the current value before assuming either state." },
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
        id: "admin-home",
        title: "The admin home (your action-first landing)",
        address: "/admin",
        blocks: [
          { type: "prose", text: "When you sign in, /admin is built around what needs a human right now, not a wall of links. Everything on it is permission-gated and degrades quietly, so you only see the parts your role can act on." },
          { type: "subheading", text: "What's on it" },
          { type: "list", items: [
            "Active incidents banner: shows only when there's an unresolved operational alert (for example a Twilio health problem). If it's there, read it.",
            "“Needs your attention”: the priority work queue, most-urgent first (billing disputes and failed billing, then content review, Cornerstone, error bounty, pronoun review, theme tags, and outreach). Queues with nothing waiting are hidden.",
            "Inline review: the top few flagged verse slots can be approved or rejected right on the home page.",
            "Inline resolve: open action items (next section) can be resolved in place.",
            "“At a glance”: a small status strip, not charts, with subscribers awaiting their SMS reply, today's sends (delivered and failed), the nearest-to-empty content track, and MRR (MRR only if your role can see revenue).",
            "Quick links: the de-emphasized nav to every other screen your role can reach.",
          ] },
          { type: "callout", kind: "info", title: "Role-gated, top to bottom", text: "Each block checks its own permission. If a queue or metric is missing from your home page, it's limited to another role, not broken." },
        ],
      },
      {
        id: "admin-action-items",
        title: "Action items (billing & disputes)",
        address: "/admin (Needs your attention)",
        relatedRoute: "/admin/action-items",
        blocks: [
          { type: "prose", text: "Action items are operational to-dos raised automatically by the Stripe webhook and worked from the admin home. There is no separate screen: they surface in “Needs your attention” and are resolved in place. Two kinds exist today." },
          { type: "list", items: [
            "Failed billing: a subscription charge failed (a trial-end or renewal attempt). It clears itself if a later charge for that same subscription succeeds, so you only act on ones that stay open.",
            "Dispute review: a chargeback that IGY won, which needs a human decision on whether to reinstate the subscriber. It won't reinstate on its own.",
          ] },
          { type: "prose", text: "Resolving one is a single click on the home page, and it records who resolved it. Items are de-duplicated, so the same failed charge or dispute never stacks up more than once." },
          { type: "callout", kind: "info", title: "Permission: finance.action_items.view", text: "Seeing and resolving action items requires finance.action_items.view. Currently super_admin only." },
        ],
      },
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
          { type: "subheading", text: "Group enrollment and roster" },
          { type: "prose", text: "Each partner church can get a shareable enrollment link and short code that a minister hands to their teens. A teen who signs up through it self-enrolls with their own info, and the resulting subscription is attributed to that church; billing is unchanged, each teen still bills individually. From here you can show a church's code and its joined count, and rotate, pause, or resume the link. There is also an optional first-names-only roster a church can paste in to track who has and hasn't joined yet; it holds no contact information and never sends anything." },
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
          { type: "prose", text: "The main queue shows exceptions only: the days where the AI flagged something or disagreed with itself. A companion view at /admin/review/batch shows every slot for a track and date window, including the days the exceptions queue never lists, so you can approve a whole upcoming batch day by day." },
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
          { type: "prose", text: "Create and manage Stripe-native discount codes (including the affinity codes in Part 3). Each code is a real Stripe coupon plus promotion code; the IGY-specific rules live in its metadata." },
          { type: "subheading", text: "What you can set on a code" },
          { type: "list", items: [
            "Percent off or a fixed dollar amount off.",
            "Duration: once, forever, or repeating for N months.",
            "A total redemption cap and a per-customer cap.",
            "An active-from date and an expiry date.",
            "Which plan tiers it applies to (none selected means all tiers).",
            "First-time-customers-only.",
            "An attestation the buyer must confirm at signup (used by the affinity codes).",
            "A required add-on: a code can require the DM from Him add-on, so the discount only applies when the buyer includes it. Enforced at subscription creation.",
          ] },
          { type: "subheading", text: "Managing existing codes" },
          { type: "list", items: [
            "Search by code or internal label.",
            "Show or hide inactive codes (shown by default).",
            "Each row shows the discount, window, redemptions, its rules as small pills, and status.",
            "Deactivate soft-disables a code in Stripe; it is never hard-deleted, and the discount math can't be edited after creation.",
          ] },
          { type: "prose", text: "Staff who can see revenue also get an ARR Impact Simulator here for modeling a code's effect." },
          { type: "callout", kind: "info", title: "Permission: billing.promo_codes.view (super_admin)", text: "All promo-code permissions are currently super_admin only. Creating, editing, and deactivating each check their own permission." },
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
          { type: "prose", text: "The business metrics view: subscribers, revenue, funnel, delivery, and content health. It is a first-pass dashboard meant to be adjusted freely." },
          { type: "list", items: [
            "A 7, 30, or 90 day range toggle across the whole page.",
            "A demo-data toggle: with real figures still near zero this early after launch, this fills the charts with clearly-labeled illustrative numbers (nothing is written to the database).",
            "A strip of at-a-glance tiles (MRR, net revenue, active subscribers, ARPU, new signups, churn, delivery), each expanding to a fuller trend.",
            "Charts for revenue (net and gross, with a click-through to a by-plan and by-source breakdown), MRR and ARR, signups, acquisition source, the signup-to-active funnel, churn, plan and focus-track mix, a delivery heatmap, daily delivery, and SMS spend.",
            "A content-runway card per track, and a reserved-donation-fund card for staff who can see revenue.",
            "A promo-code performance panel: revenue and conversions per code, sortable, with a click-through per code.",
          ] },
          { type: "callout", kind: "info", title: "Permission: analytics.dashboard.view (super_admin)", text: "Revenue and ARR-impact figures are further gated by analytics.revenue.view." },
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
        id: "admin-cause-promotions",
        title: "Cause Promotions",
        address: "/admin/cause-promotions",
        relatedRoute: "/admin/cause-promotions",
        blocks: [
          { type: "prose", text: "Tracks any promotion where certain subscriptions pledge a share of their net proceeds to a charity or cause. A rule (any combination of promo code, plan interval, and/or the DM-from-Him add-on, plus a date window) decides which subscriptions count. This generalizes the Camp Hardtner pledge; a promotion is just a row, so future causes reuse the same screen." },
          { type: "subheading", text: "Two revenue figures, always kept separate" },
          { type: "list", items: [
            "Contributed so far (REALIZED): money actually collected. Driven off settled Stripe payments, so a trial that cancels before it is ever charged counts as zero. This is the only figure the pledged payout is computed against.",
            "Pending if trials convert (POTENTIAL): the expected value of qualifying subscriptions still in their trial (signed up, not yet charged, not cancelled). It is a projection, never real money, and it expires to zero at the promotion's end date.",
          ] },
          { type: "callout", kind: "info", title: "Payout is only ever on realized", text: "The pledged payout percentage applies to realized (collected) revenue only, never to potential. We never commit a payout against money that has not actually been collected." },
          { type: "subheading", text: "The window and phase" },
          { type: "prose", text: "Each promotion has a start and end datetime. Membership freezes at the end: no new subscription can join the pool after the end date. But a subscription that joined in-window keeps adding to realized as its payments settle later (a late-December signup that converts in January still counts). Phase (scheduled / active / closed) is derived from the dates, so there is no manual off switch. The widget refreshes hourly and on demand." },
          { type: "callout", kind: "info", title: "Customer-facing page is built but dark", text: "There is a tokenized, no-login customer page that would let a subscriber see their own contribution (realized and potential, clearly labeled). It stays fully off until BOTH the global flag and a promotion's own customer-facing toggle are enabled. Do not tell customers it exists until Iain turns it on for a specific promotion." },
          { type: "callout", kind: "info", title: "Permission: analytics.revenue.view (super_admin)", text: "Viewing the tracker is gated on analytics.revenue.view, the same revenue tier as the KPI dashboard." },
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
      {
        id: "admin-outreach",
        title: "Outreach Campaigns",
        address: "/admin/outreach",
        relatedRoute: "/admin/outreach",
        blocks: [
          { type: "prose", text: "The outreach system finds churches and youth organizations to invite, organized as named, geographic campaigns you can track over time. It is how IGY does targeted cold outreach, and it is gated behind its own approvals so nothing goes out by accident." },
          { type: "subheading", text: "Creating a campaign" },
          { type: "prose", text: "A campaign is a place plus a radius. On a map of North America you pick a center (click it, drag the pin, or search a place name) and set a radius, then save it with a name. That saved campaign is what performance rolls up to." },
          { type: "subheading", text: "Discovery" },
          { type: "prose", text: "Running discovery searches public sources for churches within the campaign's radius, using only publicly posted general contact emails and youth-ministry signals. Each lead is placed on the map and, where a public attendance figure exists, sized. A lead with no findable attendance is marked “unknown,” never guessed." },
          { type: "list", items: [
            "Size buckets: small (under 100), medium (100 to 499), large (500 to 1,999), mega (2,000 and up), and unknown.",
            "Discovered leads land “staged”: found, but NOT yet in the send pipeline.",
          ] },
          { type: "subheading", text: "Promoting leads to send" },
          { type: "prose", text: "You choose which staged leads become active, by size bucket (for example, promote only the mega churches in a campaign). Only promoted (active) leads can ever receive an email. This is the deliberate gate between “found” and “contacted.”" },
          { type: "subheading", text: "Sending" },
          { type: "prose", text: "A campaign can be sent as its own deliberate push, separate from the company-wide send, so its results trace cleanly to that campaign. Every send is still governed by the same outreach approvals (copy approved, legal approved, and the live master switch) plus an optional address allowlist, and a dry-run preview shows exactly who would receive what before anything real goes out." },
          { type: "subheading", text: "Per-campaign offer" },
          { type: "prose", text: "Each campaign can carry its own discount and message variant, so you can tell a weak region apart from a weak offer. The discount is a number that flows into both the promo code and the wording (“15% off”); the message copy itself is fixed in code and approved, so a campaign can only pick an approved variant, never write its own." },
          { type: "subheading", text: "Performance leaderboard" },
          { type: "prose", text: "/admin/outreach/performance is a compact, rates-first table (not a chart wall): per campaign and per size bucket it shows contacted, redeemed, conversion rate, the offer, net revenue, and first-charge revenue. It answers where to focus next and whether church size actually predicts conversion." },
          { type: "callout", kind: "info", title: "Permission: marketing.outreach.view", text: "Viewing requires marketing.outreach.view; creating campaigns, promoting leads, and sending require marketing.outreach.manage. Currently super_admin only." },
        ],
      },
      {
        id: "admin-roles",
        title: "Roles & staff",
        address: "/admin/roles",
        relatedRoute: "/admin/roles",
        blocks: [
          { type: "prose", text: "Where staff accounts and what each role can do are managed. Changes take effect immediately, with no redeploy, because permissions are read live on every request." },
          { type: "list", items: [
            "Roles & permissions tab: create a role and turn individual permissions on or off in a grid grouped by category.",
            "Staff tab: onboard a person by email and role; if they don't have a login yet, an account is created and they sign in by magic link at /admin/login.",
          ] },
          { type: "callout", kind: "warning", title: "super_admin is locked", text: "The super_admin role always has every permission and cannot be edited here. That guard is deliberate: because access is data-driven, it stops anyone from accidentally locking every admin out." },
          { type: "callout", kind: "info", title: "Permission: admin.roles.manage", text: "Managing roles and staff requires admin.roles.manage. Currently super_admin only." },
        ],
      },
      {
        id: "admin-pronoun-review",
        title: "Divine-pronoun corrections",
        address: "/admin/pronoun-review",
        relatedRoute: "/admin/pronoun-review",
        blocks: [
          { type: "prose", text: "A focused review queue for one thing: verses where the fidelity check flagged a lowercase divine pronoun (he, him, his) that may refer to God. The correction is proposed automatically, but nothing changes until a person approves it." },
          { type: "list", items: [
            "Each row shows the current live verse and the proposed version, with only the changed words highlighted.",
            "Approving writes the correction to the live verse and clears the flag; rejecting leaves the verse as-is.",
          ] },
          { type: "callout", kind: "info", title: "Permission: content.queue.view", text: "Open to content_reviewer and super_admin; approving requires content.queue.approve." },
        ],
      },
      {
        id: "admin-sponsors",
        title: "Sponsors",
        address: "/admin/sponsors",
        relatedRoute: "/admin/sponsors",
        blocks: [
          { type: "prose", text: "The internal console for the Sponsor Program: add and edit sponsors (name, logo, contact, amount, dates, vetting notes). New sponsors start as pending review." },
          { type: "callout", kind: "warning", title: "Program is paused (off for now, not gone)", text: "The Sponsor Program was deprioritized 2026-08-01 in favor of Cornerstone (zero sponsors and zero inquiries to date). SPONSORS_ENABLED is false, so every public sponsor surface is hidden and both /sponsors and /sponsor-inquiry return 404. This admin screen and all sponsor data are intentionally kept so the program can be switched back on. Don't tell anyone sponsorship is currently available." },
          { type: "callout", kind: "info", title: "Permission: marketing.sponsors.view", text: "Viewing requires marketing.sponsors.view; editing requires marketing.sponsors.manage. Currently super_admin only." },
        ],
      },
      {
        id: "admin-season-review",
        title: "Season Review",
        address: "/admin/season-review",
        relatedRoute: "/admin/season-review",
        blocks: [
          { type: "prose", text: "The review console for Holy Season content (Christmastide, Advent, Eastertide, Lent). It is separate from the daily Review Queue: seasonal content is approved as a batch, day by day, and a season can only bill once every day in its batch is approved." },
          { type: "callout", kind: "warning", title: "Built, but dormant", text: "The Holy Season add-ons are fully built but flag-gated off (SEASONS_ENABLED is false): the billing and send paths no-op and nothing is offered to customers. This screen lets reviewers get seasonal batches ready ahead of any future go-live. Do not tell customers seasons are available; they are not live." },
          { type: "callout", kind: "info", title: "Permission: content.queue.view", text: "Open to content_reviewer and super_admin; approving requires content.queue.approve." },
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
            ["PURCHASES_ENABLED", "Flag gating whether IGY can actually bill anyone (currently true; IGY is live)."],
            ["CORNERSTONE_ENABLED", "Flag gating the Cornerstone program's public surfaces (currently true)."],
          ] },
        ],
      },
    ],
  },
];
