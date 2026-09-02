"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import Wordmark from "./Wordmark";
import s from "./legal.module.css";
import f from "./faq.module.css";

/**
 * FAQ page body - tabbed accordion. Content is Iain-approved, locked copy
 * (verbatim; do not reword). Structure follows USN's FAQ (tabbed accordion of
 * {q,a} items) adapted to IGY's own header/footer chrome (shared with the legal
 * pages via legal.module.css). Plans & pricing mirror lib/plans.ts; the DM from
 * Him pricing line is kept consistent with /program-terms §2.2.
 */

type Item = { q: string; a: ReactNode };
type TabKey = "basics" | "pricing" | "dm" | "programs" | "managing";

const TABS: { key: TabKey; label: string }[] = [
  { key: "basics", label: "The basics" },
  { key: "pricing", label: "Plans & pricing" },
  { key: "dm", label: "DM from Him™" },
  { key: "programs", label: "Programs & giving" },
  { key: "managing", label: "Managing & opting out" },
];

const FAQS: Record<TabKey, Item[]> = {
  basics: [
    {
      q: "What is It's God, Yo!?",
      a: (
        <p>
          It&rsquo;s God, Yo! (IGY) sends teens a Bible verse every day, translated into today&rsquo;s slang so it&rsquo;s easy for them to actually read and understand - the original verse is always included too, so nothing&rsquo;s hidden or replaced. It&rsquo;s built for parents, grandparents, and caregivers who want the peace of mind that comes from knowing they&rsquo;re putting God&rsquo;s Word in front of their teen, every single day.
        </p>
      ),
    },
    {
      q: "How does the daily text work?",
      a: (
        <p>
          Once a subscription is active, the teen gets one short message a day by SMS - a Bible verse put into clear, real language - sent at a time you choose. One text a day, not a stream of notifications.
        </p>
      ),
    },
    {
      q: "Does my teen have to agree before anything starts?",
      a: (
        <p>
          Yes. After you sign up, we text the teen and they must reply <strong>YES</strong> to confirm before the subscription activates. No YES means no activation and no charge.
        </p>
      ),
    },
    {
      q: "When does the first message arrive?",
      a: (
        <p>
          After the teen confirms with YES. You pick the send time, and the first verse lands the next day.
        </p>
      ),
    },
    {
      q: "Is this appropriate for teens / do you check age?",
      a: (
        <p>
          IGY is designed for teens, and sign-up is age- and country-aware. It&rsquo;s built to fail safe: if we can&rsquo;t confirm a teen can consent for themselves where they live, we don&rsquo;t complete the sign-up.
        </p>
      ),
    },
    {
      q: "What data do you collect about my teen, and how is it protected?",
      a: (
        <p>
          We collect only what the service needs. About the teen (the recipient): first name, phone number, and birth year - the year only, used for the age-consent check - plus the consent and delivery records the law requires, like the confirmation reply, opt-outs, and their timestamps. From you as the purchaser: your name, email, and payment details, with cards handled directly by Stripe so we never store your full card number. We share information only with Stripe (payments) and Twilio (SMS delivery), we don&rsquo;t sell personal information, and we don&rsquo;t collect government ID. Full details are in our <Link href="/privacy">Privacy Policy</Link>.
        </p>
      ),
    },
  ],
  pricing: [
    {
      q: "What plans are there, and what do they cost?",
      a: (
        <p>
          Individual - $6.99/month or $59/year, for one teen. Family - $99/year, covering up to 2 teens; each additional teen is $28/year. Gift - $59/year for one teen, bought for someone else. Group/church - per teen, per year: $28 each for 1-50 teens, $32 each for 51-150, $36 each for 151-300. For 301+ teens, contact us.
        </p>
      ),
    },
    {
      q: "Is there a free trial?",
      a: (
        <p>
          Yes - a 7-day free trial, starting when the teen confirms. You&rsquo;re not charged until it ends.
        </p>
      ),
    },
    {
      q: "Are there discount codes?",
      a: (
        <p>
          Yes - but because this is already priced as low as we can make it per day, discount codes are offered at specific times to specific people rather than published publicly. If one applies to you, you&rsquo;ll know.
        </p>
      ),
    },
    {
      q: "When am I actually charged?",
      a: (
        <p>
          Never before the teen replies YES and the free trial ends. Pricing is shown at sign-up.
        </p>
      ),
    },
    {
      q: "Can I buy It's God, Yo! as a gift?",
      a: (
        <p>
          Yes. A Gift plan is $59/year for one teen, bought on someone else&rsquo;s behalf. The person you&rsquo;re giving it to gets the confirmation text and replies <strong>YES</strong> themselves - we can&rsquo;t start the gift without their own OK, and no messages go out until they do. Seasonally, we also offer a prepaid Christmas gift you can buy now and schedule to be announced to the recipient on a date you choose.
        </p>
      ),
    },
  ],
  dm: [
    {
      q: "What is DM from Him™?",
      a: (
        <p>
          Teens hear a lot of noise every day - a lot of it negative, a lot of it confusing - and they internalize more of it than we realize. DM from Him&trade; takes that same daily verse and reframes it as a personal, first-person message, so instead of just reading Scripture, your teen hears it directly. That they&rsquo;re seen. That they matter. That someone thinks they&rsquo;re worth real time and love. Maybe your teen doesn&rsquo;t need that reminder. But maybe they do, and you don&rsquo;t know it yet.
        </p>
      ),
    },
    {
      q: "How much is it?",
      a: (
        <p>
          $2.99/month per teen, or $35.88/year alongside an annual base plan, billed as its own line item alongside your plan.
        </p>
      ),
    },
    {
      q: "How do I turn it on or off?",
      a: (
        <p>
          By text: reply <strong>DM ON</strong> to add it or <strong>DM OFF</strong> to remove it, any time. That only affects the add-on, not the base subscription.
        </p>
      ),
    },
  ],
  programs: [
    {
      q: "Is this tied to a particular church or denomination?",
      a: (
        <p>
          No. It&rsquo;s God, Yo! is non-denominational. The daily verses come straight from the King James Version of the Bible (and the Reina-Valera 1909 for Spanish-language sends), in plain, modern language - built for any family that wants Scripture in front of their teen, whatever church (if any) they call home.
        </p>
      ),
    },
    {
      q: "Does It's God, Yo! give back?",
      a: (
        <p>
          Yes. Through December 31, 2026, we&rsquo;ve pledged 20% of the net proceeds from every annual subscription that includes the DM from Him&trade; add-on and is purchased with promo code <strong>igy_episcopal</strong> or <strong>igy_hardtner</strong> to Camp Hardtner.
        </p>
      ),
    },
    {
      q: "What is the Cornerstone Partner Program?",
      a: (
        <p>
          It&rsquo;s our program for churches and youth groups that want to bring the daily verse to their whole congregation, with recognition for partnering churches - a certificate, a badge, and a listing in our public partner directory. <Link href="/cornerstone">Learn more about becoming a Cornerstone Partner</Link>.
        </p>
      ),
    },
  ],
  managing: [
    {
      q: "How do I cancel?",
      a: (
        <p>
          Reply <strong>STOP</strong> to the daily-message number. STOP cancels the entire subscription - base plan and any add-on together. (To remove only DM from Him&trade; but keep the daily verse, reply DM OFF instead.)
        </p>
      ),
    },
    {
      q: "Is there an account or app to log into?",
      a: (
        <p>
          No. IGY is managed entirely by text - confirm with YES, toggle the add-on with DM ON / DM OFF, cancel with STOP.
        </p>
      ),
    },
    {
      q: "What if my teen is going through something hard?",
      a: (
        <p>
          We keep a standing resources page at <Link href="/its-okay-to-not-be-okay">itsgodyo.com/its-okay-to-not-be-okay</Link> with crisis and mental-health support. The daily verse is encouragement, not a substitute for real help - if a message ever suggests someone may be at risk, please reach out.
        </p>
      ),
    },
  ],
};

function AccordionItem({ q, a }: Item) {
  const [open, setOpen] = useState(false);
  return (
    <div className={f.item}>
      <button className={f.q} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>{q}</span>
        <span className={`${f.icon} ${open ? f.iconOpen : ""}`} aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </span>
      </button>
      {open && <div className={f.a}>{a}</div>}
    </div>
  );
}

export default function FaqContent() {
  const [tab, setTab] = useState<TabKey>("basics");
  return (
    <main className={s.page}>
      <header className={s.header}>
        <div className={s.nav}>
          <Link href="/" style={{ textDecoration: "none" }}>
            <Wordmark tone="brass" />
          </Link>
          <Link href="/" className={s.home}>
            &larr; Home
          </Link>
        </div>
      </header>
      <div className={s.wrap}>
        <div className={s.head}>
          <h1>Frequently Asked Questions</h1>
          <div className={s.operator}>
            Everything about It&rsquo;s God, Yo!&trade; - the daily verse, plans, the DM from Him&trade; add-on, and managing your subscription.
          </div>
        </div>

        <div className={s.prose}>
          <div className={f.tabs} role="tablist" aria-label="FAQ topics">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                className={`${f.tab} ${tab === t.key ? f.tabActive : ""}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className={f.accordion}>
            {FAQS[tab].map((item, i) => (
              <AccordionItem key={`${tab}-${i}`} q={item.q} a={item.a} />
            ))}
          </div>

          <section className={f.disclaimer} aria-label="About the daily verses">
            <h2>About the daily verses</h2>
            <p>
              We use AI to help select and translate the daily verses, and we review the messages personally before they go out. Even so, something might occasionally slip through. We are not responsible for any harm, whether real or perceived, that this might cause. You can opt out at any time by replying STOP.
            </p>
          </section>

          <section className={f.disclaimer} aria-label="AI and content generation">
            <h2>Does It&rsquo;s God, Yo! use AI to generate content?</h2>
            <p>
              Yes. We use AI to help generate illustrative images that show how It&rsquo;s God, Yo! fits into your family&rsquo;s life, and to help gather and organize verse selections from the King James Version (and the Reina-Valera 1909 for Spanish-language sends). Every message comes from an approved content pool grounded in those texts.
            </p>
          </section>
        </div>

        <div className={s.foot}>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/cookies">Cookies</Link>
          <Link href="/">Home</Link>
        </div>
      </div>
    </main>
  );
}
