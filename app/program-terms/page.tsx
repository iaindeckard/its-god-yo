import type { Metadata } from "next";
import { notFound } from "next/navigation";
import LegalPage from "@/components/LegalPage";
import { CORNERSTONE_ENABLED, PURCHASES_ENABLED } from "@/lib/flags";

export const metadata: Metadata = {
  title: "Program Terms — It's God, Yo!™",
  description: "The terms for It's God, Yo!™ programs — the Cornerstone Partner Program and the DM from Him add-on — in one place.",
  robots: { index: false, follow: false }, // pre-launch: not indexed until a program is live
};

export const dynamic = "force-dynamic";

/**
 * Consolidated legal/programs page — wraps every IGY program's terms in one place
 * (structure follows USN's single-page numbered-section terms; reuses IGY's own
 * LegalPage + legal.module.css). Sponsor terms are intentionally OMITTED (program
 * paused 2026-08-01); a sponsor section can be added at the marked insertion point
 * below without restructuring, and no visible placeholder space is reserved for it.
 *
 * GATING (see report/reasoning): this is a pre-launch page — its primary content
 * is Cornerstone terms for a program still behind CORNERSTONE_ENABLED, and the DM
 * from Him add-on isn't independently purchasable while PURCHASES_ENABLED is off.
 * So the page appears only once EITHER program is live (whichever launches first),
 * keeping the terms in-context with a reachable program rather than describing an
 * invisible one.
 */
export default function ProgramTermsPage() {
  if (!CORNERSTONE_ENABLED && !PURCHASES_ENABLED) notFound();

  return (
    <LegalPage title="Program Terms" updated="August 1, 2026">
      <p>
        This page brings together the terms for It&rsquo;s God, Yo!&trade; (&ldquo;IGY,&rdquo; operated by Deckard Enterprise International, LLC) programs in one place. These program terms are in addition to our general <a href="/terms">Terms of Service</a> and <a href="/privacy">Privacy Policy</a>. Where a program term conflicts with the general Terms of Service, the program term controls for that program.
      </p>

      {/* Topic index — jump links to each live program's terms. */}
      <nav aria-label="Programs on this page" style={{ border: "1px solid rgba(255,255,255,0.10)", borderRadius: 12, padding: "14px 16px", margin: "18px 0 8px" }}>
        <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "#7686a0", fontWeight: 700, marginBottom: 8 }}>On this page</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <a href="#cornerstone-partner-program" style={{ color: "#7ea8e0", fontSize: 15 }}>1. Cornerstone Partner Program</a>
          <a href="#dm-from-him" style={{ color: "#7ea8e0", fontSize: 15 }}>2. DM from Him add-on</a>
        </div>
      </nav>

      {/* ─────────────────────────── Cornerstone ─────────────────────────── */}
      <h2 id="cornerstone-partner-program">1. Cornerstone Partner Program</h2>

      <h3>1.1 What the program is</h3>
      <p>
        The Cornerstone Partner Program recognizes churches that join It&rsquo;s God, Yo! during its founding stage. A church that is approved as a Cornerstone Partner receives permanent recognition, a permanent Cornerstone Partner number, a downloadable certificate and badge, optional recognition on our public Cornerstone Partners page, and, where applicable, protected pricing under the terms below. Cornerstone recognition is a form of honorary recognition; it is not an ownership, investment, membership, or governance interest in IGY or Deckard Enterprise International, LLC, and confers no voting, financial, or equity rights.
      </p>

      <h3>1.2 Eligibility and enrollment</h3>
      <p>
        A church qualifies for consideration by submitting a Cornerstone Partner application and, where required, purchasing an eligible church or group subscription during the enrollment period. The person submitting the application must confirm that they are authorized to act on behalf of the church. Enrollment may be limited to a defined enrollment window, and IGY may open, close, or change the enrollment window and the eligible subscription plans at its discretion. Approval is not automatic: IGY reviews applications and may approve or decline any application, in its sole discretion, including for eligibility, brand-safety, or mission-alignment reasons. IGY may operate approval on a manual-review basis or, at its discretion, enable automatic approval for applications that meet the qualifying criteria during the enrollment window.
      </p>

      <h3>1.3 Your Cornerstone Partner number is permanent</h3>
      <p>
        On approval, a church is assigned a unique, sequential Cornerstone Partner number. This number is permanent and is never reused or reassigned. A church keeps its original Cornerstone Partner number even if it later changes its church name, primary contact, administrator, subscription size, or contact information. Cancelled, inactive, or deleted accounts do not cause other churches&rsquo; numbers to change. The number is assigned only after a church is formally approved and, where required, has completed the qualifying purchase.
      </p>

      <h3>1.4 Recognition and locked pricing are separate</h3>
      <p>
        A church&rsquo;s Cornerstone Partner recognition and any protected (&ldquo;locked&rdquo;) pricing benefit are related but are <strong>not the same thing</strong>, and are tracked separately. A church may retain its historical Cornerstone Partner recognition even if it later loses the locked-pricing benefit under the terms of the program. Recognition is honorary and permanent; the locked-pricing benefit is conditional and governed by section 1.5.
      </p>

      <h3>1.5 Locked pricing</h3>
      <p>
        Where a locked-pricing benefit applies, a Cornerstone Partner may retain the eligible qualifying base rate it received when it entered the program, subject to the program terms in effect. <strong>This protected rate is not permanent or unconditional.</strong> The rate remains protected only while the church maintains an eligible, active account in good standing under the Cornerstone Partner terms. We do not offer &ldquo;lifetime&rdquo; or &ldquo;forever&rdquo; pricing.
      </p>
      <ul>
        <li>The locked rate applies to the original qualifying plan and the number of included participants associated with it. Additional participants beyond the included amount are billed at the then-current rate for additional participants.</li>
        <li>Cancellation of the qualifying subscription may end the locked-pricing benefit. A church that cancels and later returns is not guaranteed its original rate and may be subject to then-current pricing.</li>
        <li>A lapse in payment may suspend or end the locked-pricing benefit, subject to any grace period IGY chooses to offer at its discretion.</li>
        <li>Plan changes may affect eligibility for the locked rate, as described in the pricing rules in effect at the time.</li>
        <li>Losing the locked-pricing benefit does not remove a church&rsquo;s Cornerstone Partner recognition (see section 1.4).</li>
      </ul>

      <h3>1.6 Public recognition</h3>
      <p>
        A church appears on the public Cornerstone Partners page only if it has expressly opted in to public recognition, and its logo is shown publicly only if it has separately authorized logo display. A church may ask IGY to change or turn off its public listing at any time; doing so does not affect its underlying Cornerstone Partner recognition. The public directory shows only a church&rsquo;s name, city and state/province, country, website (if supplied), authorized logo, Cornerstone Partner number, and year joined. It never shows personal contact names, email addresses, phone numbers, youth-group size, billing information, or internal notes.
      </p>

      <h3>1.7 Certificate and badge</h3>
      <p>
        Approved Cornerstone Partners may download a certificate and a badge recognizing their status. The certificate and badge are provided for the church&rsquo;s own use in recognizing its Cornerstone Partnership (for example, on the church&rsquo;s website, newsletter, or printed materials). The It&rsquo;s God, Yo!&trade; name, marks, and the Cornerstone Partner badge remain the property of Deckard Enterprise International, LLC and may be used only to accurately represent the church&rsquo;s Cornerstone Partner status; they may not be altered or used in a way that implies endorsement of unrelated activities. IGY may ask a church to stop using the marks if its Cornerstone status ends.
      </p>

      <h3>1.8 Discounts are not stackable</h3>
      <p>
        Any Cornerstone locked-pricing benefit is applied under these program terms and is not an ordinary coupon. Promotional discounts (including church-affinity codes such as the Episcopal and Camp Hardtner offers) are not stackable, are not automatically combined with Cornerstone pricing, and only one promotional discount may apply unless IGY expressly grants an exception. Where a promotional code and a Cornerstone benefit would otherwise combine, IGY will apply them according to these terms rather than as a stacked discount.
      </p>

      <h3>1.9 Program changes; terms version</h3>
      <p>
        IGY may modify or discontinue the Cornerstone Partner Program, or these program terms, on a going-forward basis. The version of these terms a church accepted at the time of its application is recorded with its application. Material changes affecting existing Cornerstone Partners will be communicated before they take effect where reasonably practicable.
      </p>

      {/* ─────────────────────────── DM from Him ─────────────────────────── */}
      <h2 id="dm-from-him">2. DM from Him add-on</h2>

      <h3>2.1 What it is</h3>
      <p>
        &ldquo;DM from Him&rdquo; is an optional paid add-on that a purchaser may add to any It&rsquo;s God, Yo! subscription. It is <strong>not</strong> a second, separately-selected message and does not send different or additional content. It takes the <strong>same</strong> daily verse the recipient already receives and re-frames it as a personal, first-person note &mdash; the feel of a text written directly to the recipient rather than a citation. The underlying Scripture selected for that day is unchanged; only the wording and framing of the message differ.
      </p>

      <h3>2.2 Pricing and billing</h3>
      <p>
        The DM from Him add-on is billed at <strong>$2.99 per month</strong>. It is always billed as its own separate monthly line item, independent of the base subscription plan it is added to. As with all IGY subscriptions, no charge occurs until the recipient personally confirms by text; the add-on is then billed as part of the resulting subscription. Current pricing is shown at signup and may change on a going-forward basis; a change will not retroactively affect an active subscription&rsquo;s current billing period.
      </p>

      <h3>2.3 Trial, adding, removing, and cancelling</h3>
      <p>
        The add-on shares the base subscription&rsquo;s single free-trial period &mdash; there is no separate trial for the add-on, and no charge for it occurs until the base subscription&rsquo;s trial ends. Because It&rsquo;s God, Yo! has no separate account login, the add-on is managed by text message:
      </p>
      <ul>
        <li>The add-on can be turned on at signup, or added or removed later at any time by texting <strong>DM ON</strong> or <strong>DM OFF</strong> to the daily-message number. This changes only the add-on and does not affect the base subscription.</li>
        <li>Turning the add-on on or off mid-cycle may be reflected as a proration on the next invoice for the affected monthly period.</li>
        <li>Replying <strong>STOP</strong> cancels the <strong>entire</strong> subscription &mdash; the base plan and the DM from Him add-on together. There is no way to cancel only the base plan while keeping the add-on; use DM OFF to remove just the add-on.</li>
      </ul>

      {/*
        SPONSOR PROGRAM TERMS — intentionally omitted. The Sponsor Program is paused
        as of 2026-08-01 (see igy_sponsor_program_deprioritized_2026-08-01.md); there
        is nothing live to document. When/if the program resumes, add a "3. Sponsor
        Program" <h2 id="sponsor-program"> section here and a matching entry in the
        topic index above — no other restructuring is required.
      */}

      <h2>Contact</h2>
      <p>
        Questions about these program terms can be sent to <a href="mailto:hello@itsgodyo.com">hello@itsgodyo.com</a>.
      </p>
      <p>
        Deckard Enterprise International, LLC<br />
        2221 N Amarado St, Wichita, KS 67205
      </p>
    </LegalPage>
  );
}
