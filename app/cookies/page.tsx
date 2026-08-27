import type { Metadata } from "next";
import LegalPage from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Cookie Policy | It's God, Yo!™",
  description: "What cookies and similar technologies the It's God, Yo!™ website uses.",
};

export default function CookiesPage() {
  return (
    <LegalPage title="Cookie Policy" updated="August 27, 2026">
      <h2>1. What this page covers</h2>
      <p>
        This page explains what cookies and similar technologies (like browser local storage) the itsgodyo.com website uses when you visit or sign up. It describes what the site <strong>actually does</strong>, not an aspirational policy.
      </p>

      <h2>2. What the site actually uses</h2>
      <p>Except for the limited social media support period described below, the site:</p>
      <ul>
        <li>sets <strong>no cookies of its own</strong> during normal browsing;</li>
        <li>uses <strong>no</strong> browser local storage or session storage;</li>
        <li>runs <strong>no advertising cookies or third-party ad trackers</strong>.</li>
      </ul>

      <h2>3. Limited social media support period</h2>
      <p>
        Effective August 27, 2026, IGY may, at its discretion, engage a third-party service provider to assist with social media posts for a limited 30-day period. To perform that work and measure its effectiveness, the provider may use analytics or tracking tools on the IGY website during that period.
      </p>
      <p>
        Those tools may collect information about site visits, sessions, page views, clicks and other interactions, referral sources, device and browser details, IP addresses, and identifiers used to distinguish a browser or session. IGY does not authorize the provider to use this information for unrelated advertising or to sell personal information.
      </p>
      <p>
        This limited period runs from August 27 through September 25, 2026. IGY may end the engagement or disable the tools sooner. Any third-party analytics or tracking tools used for this purpose must be removed or separately disclosed before they continue beyond this period.
      </p>

      <h2>4. Payment processing (Stripe)</h2>
      <p>
        When you reach the payment step of signup, our payment processor, Stripe, may set its own cookies as part of fraud prevention and secure checkout. These are governed by Stripe&rsquo;s own cookie and privacy policies, not by us directly. Stripe is only loaded on the payment step; it does not run while you browse the rest of the site.
      </p>

      <h2>5. Your choices</h2>
      <p>
        You can control cookies through your browser settings, including blocking or deleting them. Note that blocking cookies needed for the payment step may prevent checkout from working correctly.
      </p>

      <h2>6. Changes to this policy</h2>
      <p>
        If our actual use of cookies changes (for example, if we add an analytics tool), we will update this page to match, not the other way around. This page should always describe what the site actually does.
      </p>

      <h2>7. Contact us</h2>
      <p>
        Deckard Enterprise International, LLC<br />
        Wichita, KS 67205
      </p>
    </LegalPage>
  );
}
