import type { Metadata } from "next";
import Link from "next/link";
import Wordmark from "@/components/Wordmark";
import { DM_ADDON, FAMILY_EXTRA_TEEN, PLANS } from "@/lib/plans";
import s from "./pricing.module.css";

export const metadata: Metadata = {
  title: "Plans and Pricing | It's God, Yo!™",
  description:
    "See monthly, annual, family, gift, and church pricing for the It's God, Yo! daily scripture text service.",
};

const money = (amount: number) => `$${amount % 1 === 0 ? amount.toFixed(0) : amount.toFixed(2)}`;

export default function PricingPage() {
  return (
    <main className={s.page}>
      <header className={s.header}>
        <Link href="/" aria-label="It's God, Yo! home"><Wordmark tone="brass" /></Link>
        <nav aria-label="Pricing page">
          <Link href="/sample">Sample</Link>
          <Link href="/signup" className={s.navCta}>Get started</Link>
        </nav>
      </header>

      <section className={s.hero}>
        <div className={s.eyebrow}>PLANS &amp; PRICING</div>
        <h1>One daily scripture text. Pick the plan that fits.</h1>
        <p>
          Every plan includes a 7-day free trial that starts only after the recipient replies YES. Nothing is charged before confirmation or during the trial.
        </p>
      </section>

      <section className={s.grid} aria-label="Available plans">
        <article className={s.card}>
          <h2>Individual monthly</h2>
          <div className={s.price}>{money(PLANS.individual_monthly.amount!)}<span>/month</span></div>
          <p>One teen, billed monthly after the free trial.</p>
          <Link href="/signup?plan=individual">Choose monthly</Link>
        </article>
        <article className={`${s.card} ${s.featured}`}>
          <div className={s.badge}>Best value</div>
          <h2>Individual annual</h2>
          <div className={s.price}>{money(PLANS.individual_annual.amount!)}<span>/year</span></div>
          <p>One teen, billed once a year after the free trial.</p>
          <Link href="/signup?plan=individual">Choose annual</Link>
        </article>
        <article className={s.card}>
          <h2>Family</h2>
          <div className={s.price}>{money(PLANS.family_annual.amount!)}<span>/year</span></div>
          <p>Covers up to 2 teens. Each additional teen is {money(FAMILY_EXTRA_TEEN.amount)}/year.</p>
          <Link href="/signup?plan=family">Choose family</Link>
        </article>
        <article className={s.card}>
          <h2>Gift</h2>
          <div className={s.price}>{money(PLANS.gift_annual.amount!)}<span>/year</span></div>
          <p>One annual subscription purchased for someone else.</p>
          <Link href="/signup?plan=gift">Choose gift</Link>
        </article>
      </section>

      <section className={s.details}>
        <h2>Optional add-on</h2>
        <p><strong>DM from Him™:</strong> {money(DM_ADDON.monthly_amount)}/month per teen, or {money(DM_ADDON.annual_amount)}/year with an annual plan.</p>
        <h2>Groups and churches</h2>
        <p>Group pricing is based on group size and begins at $28 per teen per year. Tell us about your church or group and we&rsquo;ll help you choose the right plan.</p>
        <Link href="/cornerstone">Explore church and group enrollment</Link>
      </section>

      <footer className={s.footer}>
        <span>&copy; 2026 Deckard Enterprise International, LLC</span>
        <div><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/cookies">Cookies</Link></div>
      </footer>
    </main>
  );
}
