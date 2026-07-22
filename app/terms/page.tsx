import type { Metadata } from "next";
import LegalPage from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Terms of Service — It's God, Yo!",
  description: "The terms that govern your use of It's God, Yo!",
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="July 22, 2026">
      <h2>1. What IGY is</h2>
      <p>
        It&rsquo;s God, Yo! (&ldquo;IGY&rdquo;) is a subscription SMS/text service that sends a daily scripture message to a recipient&rsquo;s phone. A purchaser (typically a parent, guardian, or gift-giver) sets up and pays for the subscription; the recipient (often a teen) must personally confirm by replying YES before any subscription is created or any charge occurs.
      </p>

      <h2>2. Eligibility</h2>
      <p>
        The purchaser must be at least 18 years old and have the legal authority to enter into this agreement. This service is intended to be authorized by a parent or legal guardian on behalf of a minor recipient. By authorizing a subscription for a minor, the purchaser represents that they have the legal authority to do so on that minor&rsquo;s behalf.
      </p>

      <h2>3. How billing works</h2>
      <ul>
        <li>At signup, the purchaser&rsquo;s payment method is saved via Stripe. No charge is made at this point.</li>
        <li>A confirmation text is sent to the recipient&rsquo;s phone number. Only after the recipient replies YES is a subscription created, starting a 7-day free trial from the moment of that confirmation (not from the signup date).</li>
        <li>On day 8, the saved payment method is automatically charged for the plan selected (see current pricing at signup).</li>
        <li>If the recipient does not reply within 48 hours, no subscription is created and no charge occurs. The purchaser will be notified and may resend the confirmation text manually, up to 3 times within 30 days of the original signup. After 30 days, a new signup is required.</li>
      </ul>

      <h3>3a. Family plan billing and trial timing</h3>
      <p>
        The Family plan covers up to 2 confirmed teens for the base price. Each additional teen beyond the first 2 is billed separately at the current per-teen rate shown at signup.
      </p>
      <ul>
        <li>Every teen on a Family plan gets their own independent 7-day free trial starting from the moment <strong>that</strong> teen personally confirms.</li>
        <li>Billing for each additional teen begins after that teen&rsquo;s own 7-day trial.</li>
        <li>An unconfirmed teen slot is never billed.</li>
        <li>Because each teen&rsquo;s trial runs on their own independent clock, teens on the same family account may have different trial end dates depending on when each confirmed. This is intentional.</li>
      </ul>

      <h2>4. Plans</h2>
      <p>
        Current plans and pricing are shown at signup and may change from time to time; changes will not retroactively affect an active subscription&rsquo;s current billing period.
      </p>

      <h2>5. Cancellation and refunds</h2>
      <p>
        You may cancel your subscription at any time before your next billing date to avoid being charged for the next period. Because every subscription includes a full 7-day free trial with no charge until the recipient confirms, we do not offer refunds for a billing period once payment has been collected, except where required by law. If you believe you were charged in error, contact us.
      </p>

      <h2>6. Referral and promotional codes</h2>
      <p>
        Referral codes and promo codes are subject to the terms shown at the time of use and may be modified or discontinued at our discretion. Codes have no cash value and cannot be combined unless explicitly stated.
      </p>

      <h2>7. Acceptable use</h2>
      <p>
        IGY may not be used to sign up a phone number you do not have a genuine connection to, or without a good-faith belief that the recipient would want to receive it. Purchasers must attest to this at signup. We reserve the right to suspend or terminate any account used to harass, spam, or sign up numbers without a genuine relationship to the purchaser.
      </p>

      <h2>8. Opt-out</h2>
      <p>
        Any recipient may stop receiving texts at any time by replying STOP (or any other clear request to stop) to any message. Stopping messages does not automatically cancel or refund an active subscription; the purchaser must separately manage billing.
      </p>

      <h2>9. Disclaimers</h2>
      <p>
        IGY provides scripture content for personal reflection and is not a substitute for pastoral counsel, medical care, or professional mental health support. See our <a href="/its-okay-to-not-be-okay">Crisis and Mental Health Resources page</a> if you or someone you know needs immediate help.
      </p>

      <h2>10. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, Deckard Enterprise International, LLC&rsquo;s total liability arising from or relating to this service is limited to the amount you paid us in the twelve months preceding the claim. We are not liable for indirect, incidental, or consequential damages.
      </p>

      <h2>11. Governing law</h2>
      <p>These terms are governed by the laws of the State of Kansas, without regard to conflict-of-law principles.</p>

      <h2>12. Changes to these terms</h2>
      <p>We may update these terms from time to time. Material changes will be communicated to active subscribers before taking effect.</p>

      <h2>13. Contact us</h2>
      <p>
        Deckard Enterprise International, LLC<br />
        2221 N Amarado St, Wichita, KS 67205
      </p>
    </LegalPage>
  );
}
