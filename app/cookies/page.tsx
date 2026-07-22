import type { Metadata } from "next";
import LegalPage from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Cookie Policy — It's God, Yo!",
  description: "What cookies and similar technologies the It's God, Yo! website uses.",
};

export default function CookiesPage() {
  return (
    <LegalPage title="Cookie Policy" updated="July 22, 2026">
      <h2>1. What this page covers</h2>
      <p>
        This page explains what cookies and similar technologies (like browser local storage) the itsgodyo.com website uses when you visit or sign up. It describes what the site <strong>actually does</strong>, not an aspirational policy.
      </p>

      <h2>2. What the site actually uses</h2>
      <p>As of the most recent review of a fresh, logged-out page load, the site:</p>
      <ul>
        <li>sets <strong>no cookies of its own</strong> during normal browsing;</li>
        <li>uses <strong>no</strong> browser local storage or session storage;</li>
        <li>loads <strong>no</strong> third-party scripts, and runs <strong>no analytics or tracking tools of any kind</strong> (no Google Analytics, Vercel Analytics, Plausible, or similar);</li>
        <li>runs <strong>no advertising cookies or third-party ad trackers</strong>.</li>
      </ul>
      <p>Because there are no non-essential cookies to consent to, the site does not show a cookie-consent banner.</p>

      <h2>3. Payment processing (Stripe)</h2>
      <p>
        When you reach the payment step of signup, our payment processor, Stripe, may set its own cookies as part of fraud prevention and secure checkout. These are governed by Stripe&rsquo;s own cookie and privacy policies, not by us directly. Stripe is only loaded on the payment step; it does not run while you browse the rest of the site.
      </p>

      <h2>4. Your choices</h2>
      <p>
        You can control cookies through your browser settings, including blocking or deleting them. Note that blocking cookies needed for the payment step may prevent checkout from working correctly.
      </p>

      <h2>5. Changes to this policy</h2>
      <p>
        If our actual use of cookies changes (for example, if we add an analytics tool), we will update this page to match &mdash; not the other way around. This page should always describe what the site actually does.
      </p>

      <h2>6. Contact us</h2>
      <p>
        Deckard Enterprise International, LLC<br />
        2221 N Amarado St, Wichita, KS 67205
      </p>
    </LegalPage>
  );
}
