import type { Metadata } from "next";
import LegalPage from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Cookie Policy | It's God, Yo!™",
  description: "What cookies and similar technologies the It's God, Yo!™ website uses.",
};

export default function CookiesPage() {
  return (
    <LegalPage title="Cookie Policy" updated="August 10, 2026">
      <h2>1. What this page covers</h2>
      <p>
        This page explains what cookies and similar technologies (like browser local storage) the itsgodyo.com website uses when you visit or sign up. It describes what the site <strong>actually does</strong>, not an aspirational policy.
      </p>

      <h2>2. What the site actually uses</h2>
      <p>As of the most recent review of a fresh, logged-out page load, the site:</p>
      <ul>
        <li>sets <strong>no cookies of its own</strong> during normal browsing;</li>
        <li>uses browser session storage for a random, temporary funnel-session identifier that expires when the browser session ends;</li>
        <li>runs limited first-party conversion measurement so we can understand whether anonymous visits progress through sampling, signup, consent, and activation;</li>
        <li>loads <strong>no</strong> third-party analytics scripts (no Google Analytics, Meta Pixel, Vercel Analytics, Plausible, or similar);</li>
        <li>runs <strong>no advertising cookies or third-party ad trackers</strong>.</li>
      </ul>
      <p>The first-party funnel record does not store message content, phone numbers, names, email addresses, full URLs, or advertising identifiers. Because it uses no cookie and is limited to essential product measurement, the site does not show a cookie-consent banner.</p>

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
        If our actual use of cookies changes (for example, if we add an analytics tool), we will update this page to match, not the other way around. This page should always describe what the site actually does.
      </p>

      <h2>6. Contact us</h2>
      <p>
        Deckard Enterprise International, LLC<br />
        Wichita, KS 67205
      </p>
    </LegalPage>
  );
}
