import type { Metadata } from "next";
import LegalPage from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy — It's God, Yo!",
  description: "How It's God, Yo! collects, uses, and protects your information.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="July 22, 2026">
      <h2>1. Who we are</h2>
      <p>
        It&rsquo;s God, Yo! (&ldquo;IGY,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;) is a daily SMS/text scripture subscription service operated by Deckard Enterprise International, LLC, a Kansas limited liability company.
      </p>

      <h2>2. What information we collect</h2>
      <p>
        <strong>From the purchaser (the adult signing up):</strong> name, email address, payment card details (collected and stored directly by our payment processor, Stripe; we do not store your full card number ourselves), language preference.
      </p>
      <p>
        <strong>About the recipient:</strong> first name, phone number, and for gift signups, the gifter&rsquo;s relationship to the recipient.
      </p>
      <p>
        <strong>Consent and delivery records:</strong> the disclosure text shown at signup and its version, timestamp of consent, the recipient&rsquo;s own confirmation reply, and opt-out requests and their timestamps.
      </p>
      <p>We do not collect payment card numbers ourselves, and we do not require or store government ID.</p>

      <h2>3. How we use your information</h2>
      <p>
        To send the recipient their daily scripture text (via Twilio), to process your subscription payment (via Stripe), to confirm consent before any subscription is created or any charge occurs, to notify the purchaser if a recipient hasn&rsquo;t confirmed within 48 hours, to administer referral codes and promotions, and to comply with SMS/telecom law and maintain consent records.
      </p>

      <h2>4. Who we share information with</h2>
      <p>
        Stripe (payment processing) and Twilio (SMS delivery). We do not sell personal information, and we do not share recipient phone numbers with advertisers or unrelated third parties.
      </p>

      <h2>5. Consent and opt-out</h2>
      <p>
        Every recipient must personally reply YES to a confirmation text before any subscription is created or any charge is made. Any recipient can stop texts at any time by replying STOP, or by any other reasonably clear request to stop.
      </p>

      <h2>6. Data retention</h2>
      <p>
        We retain consent records for at least 4 years after your last contact with us, consistent with SMS/telecom recordkeeping requirements. You can request deletion of your account information subject to these legal retention requirements.
      </p>

      <h2>7. Minors</h2>
      <p>
        IGY&rsquo;s recipients are often teenagers. This service is intended to be authorized by a parent or legal guardian, who is responsible for confirming they have the legal authority to authorize a subscription on a minor&rsquo;s behalf. Our systems are built so that, by default, nothing is enabled unless that authorization and the minor&rsquo;s own confirmation are both present.
      </p>

      <h2>8. Your rights</h2>
      <p>
        You may request access to, correction of, or deletion of your personal information by contacting us. Applicable state privacy law rights (access, deletion, opt-out of sale &mdash; we do not sell data) apply where relevant.
      </p>

      <h2>9. Changes to this policy</h2>
      <p>
        If we change this policy in a way that affects previously-collected consent, we will version the change and note the effective date. Prior consents remain tied to the disclosure text you actually saw at the time.
      </p>

      <h2>10. Contact us</h2>
      <p>
        Deckard Enterprise International, LLC<br />
        2221 N Amarado St, Wichita, KS 67205
      </p>
    </LegalPage>
  );
}
