import type { Metadata } from "next";
import LegalPage, { Ph, PhInline } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy — It's God, Yo!",
  robots: { index: false, follow: false }, // draft, pending legal review
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="July 21, 2026">
      <h2>1. Who we are</h2>
      <p>
        It&rsquo;s God, Yo! (&ldquo;IGY,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;) is a daily SMS/text scripture subscription service operated by Deckard Enterprise International, LLC, a Kansas limited liability company (Kansas SOS #10081873, EIN 42-3949754).
      </p>

      <h2>2. What information we collect</h2>
      <h3>From the purchaser (the adult signing up):</h3>
      <ul>
        <li>Name, email address</li>
        <li>Payment card details &mdash; collected and stored directly by our payment processor, Stripe; we do not store your full card number ourselves</li>
        <li>Language preference (English or Spanish)</li>
      </ul>
      <h3>About the recipient (the person who will receive texts &mdash; may be the purchaser&rsquo;s teen, or a gift/&ldquo;DM from Him&rdquo; recipient):</h3>
      <ul>
        <li>First name</li>
        <li>Phone number</li>
        <li>For gift signups: the gifter&rsquo;s relationship to the recipient (e.g., parent, grandparent, pastor) or honorific</li>
      </ul>
      <h3>Consent and delivery records (consent_log):</h3>
      <ul>
        <li>The exact disclosure text shown at signup, and its version</li>
        <li>Timestamp of consent</li>
        <li>The recipient&rsquo;s own confirmation reply (the &ldquo;YES&rdquo; text), which is the legal basis for sending them texts</li>
        <li>Opt-out requests and their timestamps</li>
      </ul>
      <p>We do not collect payment card numbers ourselves &mdash; Stripe handles that. We do not require or store government ID.</p>

      <h2>3. How we use your information</h2>
      <ul>
        <li>To send the recipient their daily scripture text via SMS (through our messaging provider, Twilio)</li>
        <li>To process your subscription payment (through Stripe)</li>
        <li>To confirm consent before any subscription is created or any charge occurs &mdash; no one is signed up without their own reply-YES confirmation</li>
        <li>To notify the purchaser if a recipient hasn&rsquo;t confirmed within 48 hours, so the purchaser can choose to resend (up to 3 times over 30 days)</li>
        <li>To administer referral codes and promotional discounts</li>
        <li>To comply with SMS/telecom law (TCPA, CTIA guidelines) and maintain records of consent</li>
      </ul>

      <h2>4. Who we share information with</h2>
      <ul>
        <li><strong>Stripe</strong> &mdash; payment processing. Stripe&rsquo;s own privacy policy governs how they handle your card data.</li>
        <li><strong>Twilio</strong> &mdash; SMS delivery. Twilio processes phone numbers and message content solely to deliver texts on our behalf.</li>
        <li>We do not sell personal information. We do not share recipient phone numbers with advertisers or unrelated third parties.</li>
      </ul>

      <h2>5. Consent and opt-out</h2>
      <p>
        Every recipient must personally reply &ldquo;YES&rdquo; to a confirmation text before any subscription is created or any charge is made &mdash; a parent, gifter, or purchaser&rsquo;s checkbox alone is never sufficient. Any recipient can stop texts at any time by replying STOP, or by any other reasonably clear request to stop.
      </p>

      <h2>6. Data retention</h2>
      <p>
        We retain consent records (disclosure text, timestamps, confirmation replies) for at least 4 years after your last contact with us, consistent with SMS/telecom recordkeeping requirements. You can request deletion of your account information subject to these legal retention requirements.
      </p>

      <h2>7. Minors</h2>
      <p>IGY&rsquo;s recipients are often teenagers.</p>
      <Ph label="Placeholder — age thresholds pending attorney confirmation">
        Age thresholds and required consent mechanisms vary by state/country and are pending attorney confirmation. Do not finalize this section until that review is complete. Our system is built to fail closed (deny by default) in any jurisdiction where age-consent rules haven&rsquo;t been confirmed.
      </Ph>

      <h2>8. Your rights</h2>
      <p>
        You may request access to, correction of, or deletion of your personal information by contacting us at <PhInline>[SUPPORT EMAIL &mdash; TBD]</PhInline>. California, Virginia, Colorado, and other state privacy law rights (access, deletion, opt-out of sale &mdash; we do not sell data) apply where applicable.
      </p>

      <h2>9. Changes to this policy</h2>
      <p>
        If we change this policy in a way that affects previously-collected consent, we will version the change and note the effective date. Prior consents remain tied to the disclosure text you actually saw at the time.
      </p>

      <h2>10. Contact us</h2>
      <p>
        Deckard Enterprise International, LLC<br />
        2221 N Amarado St, Wichita, KS 67205<br />
        <PhInline>[SUPPORT EMAIL &mdash; TBD]</PhInline>
      </p>
    </LegalPage>
  );
}
