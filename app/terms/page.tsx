import type { Metadata } from "next";
import LegalPage, { Ph, PhInline } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Terms of Service — It's God, Yo!",
  robots: { index: false, follow: false }, // draft, pending legal review
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
        The purchaser must be at least 18 years old and have the legal authority to enter into this agreement and, where applicable, to consent on behalf of a minor recipient in accordance with our Privacy Policy and applicable law.
      </p>
      <Ph label="Placeholder — pending legal review">Age-consent thresholds by jurisdiction pending attorney confirmation.</Ph>

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
        <li>Every teen on a Family plan, including additional teens beyond the first 2, gets their own independent 7-day free trial starting from the moment <strong>that</strong> teen personally confirms &mdash; not from when the family plan was purchased, and not synced to any other teen&rsquo;s confirmation timing.</li>
        <li>Billing for each additional teen begins after that teen&rsquo;s own 7-day trial, not immediately upon their confirmation.</li>
        <li>An unconfirmed teen slot is never billed. The additional-teen charge only reflects teens who have actually confirmed.</li>
        <li>Because each teen&rsquo;s trial runs on their own independent clock, it&rsquo;s possible for teens on the same family account to have different trial end dates depending on when each of them confirmed. This is intentional &mdash; we&rsquo;d rather every teen get their full, fair trial period than shorten anyone&rsquo;s trial to keep dates in sync.</li>
      </ul>

      <h2>4. Plans</h2>
      <p>
        Current plans (Individual, Family, Gift, Group, and the &ldquo;DM from Him&rdquo; +1 add-on) and pricing are shown at signup and may change from time to time; changes will not retroactively affect an active subscription&rsquo;s current billing period.
      </p>

      <h2>5. Cancellation and refunds</h2>
      <p>You may cancel your subscription at any time before your next billing date to avoid being charged for the next period.</p>
      <Ph label="Placeholder — pending legal review">Refund policy specifics &mdash; TBD, to be finalized with attorney review; note the 7-day trial already functions as a no-charge evaluation period.</Ph>

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
      <Ph label="Placeholder — pending legal review">Standard limitation-of-liability language &mdash; to be finalized with attorney review, appropriate to Kansas law and DEI&rsquo;s LLC structure.</Ph>

      <h2>11. Governing law</h2>
      <p>These terms are governed by the laws of the State of Kansas, without regard to conflict-of-law principles.</p>
      <Ph label="Placeholder — pending legal review">Confirm venue/arbitration clause with attorney before publishing.</Ph>

      <h2>12. Changes to these terms</h2>
      <p>We may update these terms from time to time. Material changes will be communicated to active subscribers before taking effect.</p>

      <h2>13. Contact us</h2>
      <p>
        Deckard Enterprise International, LLC<br />
        2221 N Amarado St, Wichita, KS 67205<br />
        <PhInline>[SUPPORT EMAIL &mdash; TBD]</PhInline>
      </p>
    </LegalPage>
  );
}
