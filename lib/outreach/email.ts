import "server-only";
import crypto from "crypto";
import { OUTREACH } from "./config";
import { SPANISH_ENABLED } from "../flags";
import type { OutreachLead } from "./leads";
import { resolveVariant, clampDiscountPercent, VARIANT_PROFILE, TOUCH2_EXPIRES_DISPLAY, type MessageVariant } from "./templates";
import { outreachEntryUrl } from "./attribution";

/**
 * One-click unsubscribe token. HMAC over the lead id so the public unsubscribe
 * link can't be forged or enumerated. Secret: OUTREACH_UNSUB_SECRET, falling
 * back to CRON_SECRET (already a server secret in this project).
 */
function unsubSecret(): string | null {
  return process.env.OUTREACH_UNSUB_SECRET || process.env.CRON_SECRET || null;
}

export function unsubToken(leadId: string): string {
  const secret = unsubSecret();
  if (!secret) return "no-secret-set"; // only reachable in dry-run without secrets
  return crypto.createHmac("sha256", secret).update(leadId).digest("hex").slice(0, 32);
}

export function verifyUnsubToken(leadId: string, token: string): boolean {
  const expected = unsubToken(leadId);
  if (expected === "no-secret-set") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(token || "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function unsubUrl(leadId: string): string {
  return `${OUTREACH.appUrl}/api/outreach/unsubscribe?lead=${encodeURIComponent(leadId)}&t=${unsubToken(leadId)}`;
}

export interface BuiltEmail {
  to: string;
  from: string;
  replyTo: string;
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

function sourceNote(lead: OutreachLead): string {
  const first = Array.isArray(lead.source_urls) ? lead.source_urls[0] : null;
  return first ? String(first).replace(/^https?:\/\//, "").replace(/\s*\(.*$/, "") : "a public listing of your ministry";
}

/**
 * Campaign-specific personal note for email 1 — one sentence inserted BEFORE the
 * generic "…has an active youth ministry…" transition, keyed by campaign_id. Any
 * campaign not listed here, and the null-campaign / global-cron fallback, get no
 * personal line (the generic sentence stands alone, exactly as before). This copy
 * is code-resident and reviewed, same governance as the rest of the template.
 */
const CAMPAIGN_INTRO: Record<string, string> = {
  // New Iberia, LA
  "7193c8f9-62c4-4e7a-ac41-a142b9ac8160":
    "I actually grew up in New Iberia, so getting this into the hands of teens back home means something to me.",
  // Dallas Metro, TX
  "0dfe6428-02a2-4e7d-8aba-1c7a6a93feb0":
    "My aunt Nora lives at The Tradition here in Dallas, so this area isn't unfamiliar to me.",
};

/**
 * Build the compliant outreach email (spec §2). The copy here is the LOCKED /
 * APPROVED version (Iain, 2026-07-28 — IGY-Church-Outreach-Email-Copy-APPROVED-
 * 2026-07-28.md). Approval of the copy does NOT open the send gate: mail still
 * goes nowhere until OUTREACH_LEGAL_APPROVED + OUTREACH_SEND_LIVE are also set
 * (see config.sendGate). Every send carries: honest From/Subject,
 * one-click List-Unsubscribe (RFC 8058) + a visible link, the required physical
 * mailing address, and Reply-To to a monitored human inbox.
 */
export function buildEmail(
  lead: OutreachLead,
  variant: MessageVariant = "default",
  discountPercent = 10,
): BuiltEmail {
  // Guardrail: only an approved variant KEY is honored; copy is code-resident.
  const v = resolveVariant(variant);
  // The Catholic K-12 Schools variant is a single email that carries the shared
  // APPRECIATION10 code + DMFH upsell up front (no code-free intro, no follow-up).
  if (v === "catholic_school") {
    return buildCatholicSchoolEmail(lead, VARIANT_PROFILE.catholic_school.sharedPromoCode ?? "APPRECIATION10", discountPercent);
  }
  const org = lead.org_name;
  const link = unsubUrl(lead.id);
  const site = OUTREACH.appUrl;
  // Campaign leads use a trusted signed entry URL. The visible label stays the
  // ordinary site URL and the visitor still lands on the ordinary homepage; this
  // changes attribution only, never the marketing claim or signup experience.
  const entry = lead.campaign_id ? outreachEntryUrl(lead.id, 1, "en") : site;
  // Campaign-specific personal note (empty for null-campaign / unlisted campaigns).
  // Trailing space so it flows straight into the generic transition sentence.
  const personalIntro = (lead.campaign_id && CAMPAIGN_INTRO[lead.campaign_id]) ? `${CAMPAIGN_INTRO[lead.campaign_id]} ` : "";
  // The "we're local too" + "support a local small business" claims render ONLY
  // when there is a real local tie: a campaign that has a CAMPAIGN_INTRO note (the
  // personal line above that earns the claim), or the Wichita-home fallback (KS).
  // Otherwise both drop entirely (e.g. Dallas, held in reserve with no CAMPAIGN_INTRO
  // entry, or an out-of-state fallback lead). The city label below stays regardless
  // because it is factual. Both claim lines gate together on hasLocalTie.
  const isFallback = !lead.campaign_id;
  const isHomeState = /^(KS|KANSAS)$/i.test((lead.state || "").trim());
  const hasCampaignIntro = !!(lead.campaign_id && CAMPAIGN_INTRO[lead.campaign_id]);
  const hasLocalTie = hasCampaignIntro || (isFallback && isHomeState);
  const localSentence = hasLocalTie ? " We're proud to say we're local too." : "";
  const localBusiness = hasLocalTie ? " Please, help support a local small business!" : "";
  // Footer locality label: the null-campaign / global-cron fallback keeps the
  // original hardcoded "Wichita-area church"; campaign leads use their OWN city
  // (campaigns now run outside KS), dropping to a plain "a church" if a campaign
  // lead somehow has no city rather than mislabeling it Wichita.
  const areaLabelText = isFallback ? "a Wichita-area church" : (lead.city ? `a ${lead.city}-area church` : "a church");
  const areaLabelHtml = isFallback ? "a Wichita-area church" : (lead.city ? `a ${esc(lead.city)}-area church` : "a church");

  const subject = `A partnership opportunity for ${org}'s youth ministry`;

  const text =
`Hi ${org} team,

I'm Iain, founder of It's God, Yo!, a daily Scripture text devotional built for teens, ${SPANISH_ENABLED ? "in English (KJV) and Spanish (Reina-Valera 1909)" : "in English (KJV)"}. Each day pairs one KJV verse with a plain-language slang rendering designed to help teens understand it, plus a link to read the full KJV text. Our review process keeps the language current while protecting the verse's meaning.

${personalIntro}${org} has an active youth ministry, and I thought this might be useful for the students you're already working with. You can see how it works and sign up at ${entry}.

No pressure here. Share it if it's a fit, ignore it if it's not. If you'd rather not hear from us again, the link below removes ${org} for good.

Thanks for helping us get the Word of God to young people every day.

Iain Deckard · It's God, Yo!
Reply to this email directly, it comes to me.

---
It's God, Yo!™ is operated by ${OUTREACH.physicalAddress}.
You received this because ${org} is ${areaLabelText} with a publicly listed youth ministry.${localSentence} We found your general contact address at ${sourceNote(lead)}.${localBusiness}
Unsubscribe (one click): ${link}`;

  const html =
`<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1a1a1a;max-width:600px;margin:0 auto;">
  <p>Hi ${esc(org)} team,</p>
  <p>I'm Iain, founder of <strong>It's God, Yo!</strong>, a daily Scripture text devotional built for teens, ${SPANISH_ENABLED ? "in English (KJV) and Spanish (Reina-Valera 1909)" : "in English (KJV)"}. Each day pairs one KJV verse with a plain-language slang rendering designed to help teens understand it, plus a link to read the full KJV text. Our review process keeps the language current while protecting the verse's meaning.</p>
  <p>${personalIntro}${esc(org)} has an active youth ministry, and I thought this might be useful for the students you're already working with. You can see how it works and sign up at <a href="${esc(entry)}" style="color:#00ABBC;">${esc(site.replace(/^https?:\/\//, ""))}</a>.</p>
  <p>No pressure here. Share it if it's a fit, ignore it if it's not. If you'd rather not hear from us again, the link below removes ${esc(org)} for good.</p>
  <p style="margin-bottom:2px;">Thanks for helping us get the Word of God to young people every day.</p>
  <p style="margin-bottom:2px;"><strong>Iain Deckard</strong> · It's God, Yo!</p>
  <p style="color:#555;">Reply to this email directly, it comes to me.</p>
  <hr style="border:none;border-top:1px solid #e2e2e2;margin:22px 0;"/>
  <p style="font-size:12px;color:#777;">
    It's God, Yo!™ is operated by ${esc(OUTREACH.physicalAddress)}.<br/>
    You received this because ${esc(org)} is ${areaLabelHtml} with a publicly listed youth ministry.${localSentence} We found your general contact address at ${esc(sourceNote(lead))}.${localBusiness}<br/>
    <a href="${link}" style="color:#777;">Unsubscribe (one click)</a>
  </p>
</div>`;

  // RFC 8058: List-Unsubscribe with an https one-click endpoint + a mailto
  // fallback; List-Unsubscribe-Post signals one-click POST support.
  const headers: Record<string, string> = {
    "List-Unsubscribe": `<${link}>, <mailto:unsubscribe@outreach.itsgodyo.com?subject=unsub-${lead.id}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };

  return { to: lead.contact_email, from: OUTREACH.from, replyTo: OUTREACH.replyTo, subject, text, html, headers };
}

/**
 * Catholic K-12 Schools variant (message_variant: 'catholic_school').
 *
 * COPY GOVERNANCE: the body below is the spec's draft copy, used VERBATIM pending
 * Iain's review, with exactly two deliberate, flagged departures from that draft:
 *   1. A short ATTESTATION-mention line (Iain authorized this addition 2026-08-20) —
 *      APPRECIATION10 requires a checkout attestation, so the email says so.
 *   2. A functional signup line ("sign up at itsgodyo.com") whose visible label is
 *      the plain site URL but whose href is the signed outreach ENTRY URL. This is
 *      structurally required: the shared code isn't stored per-lead, so per-lead
 *      conversion attribution rides this entry URL (see templates.VARIANT_PROFILE).
 * The greeting is role-based ("Dear <School> Administration") rather than the draft's
 * "Dear [Principal Name]" — chosen 2026-08-20; we do not capture principal names.
 * The only campaign-configurable value reaching the copy is the discount NUMBER,
 * substituted for the numeral in "{pct}% off".
 *
 * Single-touch: this email carries the code up front; there is no 30-day follow-up
 * (see run.ts dueTouch + VARIANT_PROFILE.singleTouch).
 */
export function buildCatholicSchoolEmail(
  lead: OutreachLead,
  promoCode: string,
  discountPercent = 10,
): BuiltEmail {
  const pct = clampDiscountPercent(discountPercent);
  const org = lead.org_name;
  const link = unsubUrl(lead.id);
  const site = OUTREACH.appUrl;
  const siteLabel = site.replace(/^https?:\/\//, "");
  // Campaign leads use the signed entry URL for attribution; visible label stays the
  // plain site URL and the visitor still lands on the ordinary homepage.
  const entry = lead.campaign_id ? outreachEntryUrl(lead.id, 1, "en") : site;
  const contactNote = sourceNote(lead);

  const subject = `A note for ${org} families`;

  const text =
`Dear ${org} Administration,

My name is Iain Deckard. I'm the founder of It's God, Yo!™ (IGY), a daily Bible verse text service for teens. A short verse matched to a mood or theme, sent by text each day.

I attended Catholic High in New Iberia, Louisiana for several years, and what's stayed with me longest isn't the academics. It's that the school led with faith every day. That's a big part of why I wanted Catholic school families nationwide, including at ${org}, to have a discount on IGY: ${pct}% off an individual annual, family, or gift subscription, using code ${promoCode} (valid through December 31, 2026). At checkout, ${promoCode} asks for a quick attestation that you're a student, caregiver, or faculty/staff at a U.S. Catholic school, nothing more. You can see how it works and sign up at ${siteLabel}.

And if you sign up today, you can also take advantage of DM from Him, an add-on where your teen can text back and forth about what that day's verse actually means for what they're going through. A verse alone is something to read; DM from Him turns it into a conversation your teen can have in the moment, when it's actually on their mind, not just something they scroll past. It's a small add, and it's the difference between a daily text and something that meets a teen where they are on a hard day.

I'd welcome five minutes to talk about it, or I'm happy to send a one-page rundown you can look at whenever it's convenient. Either works for me.

With gratitude,
Iain Deckard
Founder, It's God, Yo!™
hello@itsgodyo.com

---
It's God, Yo!™ is operated by ${OUTREACH.physicalAddress}.
You received this because ${org} is a Catholic school in ${lead.state || "the United States"} with a publicly listed contact address; we found it at ${contactNote}.
Unsubscribe (one click): ${link}`;

  const html =
`<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1a1a1a;max-width:600px;margin:0 auto;">
  <p>Dear ${esc(org)} Administration,</p>
  <p>My name is Iain Deckard. I'm the founder of <strong>It's God, Yo!&trade;</strong> (IGY), a daily Bible verse text service for teens. A short verse matched to a mood or theme, sent by text each day.</p>
  <p>I attended Catholic High in New Iberia, Louisiana for several years, and what's stayed with me longest isn't the academics. It's that the school led with faith every day. That's a big part of why I wanted Catholic school families nationwide, including at ${esc(org)}, to have a discount on IGY: <strong>${pct}% off</strong> an individual annual, family, or gift subscription, using code <strong>${esc(promoCode)}</strong> (valid through December 31, 2026). At checkout, ${esc(promoCode)} asks for a quick attestation that you're a student, caregiver, or faculty/staff at a U.S. Catholic school, nothing more. You can see how it works and sign up at <a href="${esc(entry)}" style="color:#00ABBC;">${esc(siteLabel)}</a>.</p>
  <p>And if you sign up today, you can also take advantage of <strong>DM from Him</strong>, an add-on where your teen can text back and forth about what that day's verse actually means for what they're going through. A verse alone is something to read; DM from Him turns it into a conversation your teen can have in the moment, when it's actually on their mind, not just something they scroll past. It's a small add, and it's the difference between a daily text and something that meets a teen where they are on a hard day.</p>
  <p>I'd welcome five minutes to talk about it, or I'm happy to send a one-page rundown you can look at whenever it's convenient. Either works for me.</p>
  <p style="margin-bottom:2px;">With gratitude,</p>
  <p style="margin-bottom:0;"><strong>Iain Deckard</strong></p>
  <p style="margin:0;color:#555;">Founder, It's God, Yo!&trade;</p>
  <p style="margin-top:2px;"><a href="mailto:hello@itsgodyo.com" style="color:#00ABBC;">hello@itsgodyo.com</a></p>
  <hr style="border:none;border-top:1px solid #e2e2e2;margin:22px 0;"/>
  <p style="font-size:12px;color:#777;">
    It's God, Yo!&trade; is operated by ${esc(OUTREACH.physicalAddress)}.<br/>
    You received this because ${esc(org)} is a Catholic school in ${esc(lead.state || "the United States")} with a publicly listed contact address; we found it at ${esc(contactNote)}.<br/>
    <a href="${link}" style="color:#777;">Unsubscribe (one click)</a>
  </p>
</div>`;

  const headers: Record<string, string> = {
    "List-Unsubscribe": `<${link}>, <mailto:unsubscribe@outreach.itsgodyo.com?subject=unsub-${lead.id}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };

  return { to: lead.contact_email, from: OUTREACH.from, replyTo: OUTREACH.replyTo, subject, text, html, headers };
}

/**
 * The second-touch (email 2) follow-up. For the default church variant this is a
 * light "circling back" of buildEmail carrying the shared flat TOUCH2-25 code (25%
 * off, valid through 2026-10-23) — one flat rate for every church campaign, minted
 * once by Iain, not per lead. For the catholic_school variant it's a code-free
 * DISTRIBUTION nudge (see buildSchoolsFollowupEmail). Sent ~30 days after email 1
 * to leads that haven't signed up (still active). Same compliance envelope as
 * email 1. This is the final touch: the copy says so, and the send logic stops.
 *
 * The shared code is passed in (VARIANT_PROFILE.<variant>.sharedPromoCode) rather
 * than minted; promoCode/discountPercent are the ONLY values reaching the copy and
 * they carry a fixed, reviewed code + flat percent (never a campaign's own tier).
 */
export function buildFollowupEmail(
  lead: OutreachLead,
  promoCode: string,
  discountPercent = 10,
  variant: MessageVariant = "default",
): BuiltEmail {
  // Guardrail: only an approved variant KEY is honored (copy is code-resident).
  const v = resolveVariant(variant);
  // The Catholic K-12 Schools follow-up is a code-free distribution ask, not an
  // offer — it references the existing APPRECIATION10 code and asks the school to
  // share a ready-to-paste blurb with families.
  if (v === "catholic_school") return buildSchoolsFollowupEmail(lead);
  const pct = clampDiscountPercent(discountPercent);
  const org = lead.org_name;
  const link = unsubUrl(lead.id);
  const site = OUTREACH.appUrl;
  const entry = lead.campaign_id ? outreachEntryUrl(lead.id, 2, "en") : site;
  // Footer locality (mirrors email 1): city-based label, and the "local too" +
  // "local small business" claims render ONLY on a real local tie (a campaign with
  // a CAMPAIGN_INTRO note, or the Wichita-home KS fallback); dropped otherwise.
  const isFallback = !lead.campaign_id;
  const isHomeState = /^(KS|KANSAS)$/i.test((lead.state || "").trim());
  const hasCampaignIntro = !!(lead.campaign_id && CAMPAIGN_INTRO[lead.campaign_id]);
  const hasLocalTie = hasCampaignIntro || (isFallback && isHomeState);
  const localSentence = hasLocalTie ? " We're proud to say we're local too." : "";
  const localBusiness = hasLocalTie ? " Please, help support a local small business!" : "";
  const areaLabelText = isFallback ? "a Wichita-area church" : (lead.city ? `a ${lead.city}-area church` : "a church");
  const areaLabelHtml = isFallback ? "a Wichita-area church" : (lead.city ? `a ${esc(lead.city)}-area church` : "a church");

  const subject = `Following up for ${org}: ${pct}% off through Oct 23`;

  const text =
`Hi ${org} team,

I reached out a few weeks back about It's God, Yo!, our daily Scripture text for teens, which pairs each ${SPANISH_ENABLED ? "KJV and Reina-Valera 1909 verse" : "KJV verse"} with a plain-language slang rendering designed to help teens understand it. No worries if it slipped by.

If it might be a fit for the families and students at ${org}, here's ${pct}% off, on us:

${promoCode} gets you ${pct}% off an individual, family, or gift subscription at ${entry}

One thing worth knowing: this code is good through ${TOUCH2_EXPIRES_DISPLAY}, so if you've been meaning to pass it along, now's the window. Share it if it helps, ignore it if it's not for you.

This is the last you'll hear from us unless you reach out. The link below removes ${org} for good.

Thanks for everything you pour into young people.

Iain Deckard · It's God, Yo!
Reply to this email directly, it comes to me.

---
It's God, Yo!™ is operated by ${OUTREACH.physicalAddress}.
You received this because ${org} is ${areaLabelText} with a publicly listed youth ministry.${localSentence} We found your general contact address at ${sourceNote(lead)}.${localBusiness}
Unsubscribe (one click): ${link}`;

  const html =
`<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1a1a1a;max-width:600px;margin:0 auto;">
  <p>Hi ${esc(org)} team,</p>
  <p>I reached out a few weeks back about <strong>It's God, Yo!</strong>, our daily Scripture text for teens, which pairs each ${SPANISH_ENABLED ? "KJV and Reina-Valera 1909 verse" : "KJV verse"} with a plain-language slang rendering designed to help teens understand it. No worries if it slipped by.</p>
  <p>If it might be a fit for the families and students at ${esc(org)}, here's <strong>${pct}% off</strong>, on us:</p>
  <p style="background:#f4f7f7;border:1px solid #d7e2e2;border-radius:8px;padding:12px 16px;font-size:16px;">
    <strong>${esc(promoCode)}</strong> gets you ${pct}% off an individual, family, or gift subscription at <a href="${esc(entry)}" style="color:#00ABBC;">${esc(site.replace(/^https?:\/\//, ""))}</a>
  </p>
  <p>One thing worth knowing: this code is good through <strong>${TOUCH2_EXPIRES_DISPLAY}</strong>, so if you've been meaning to pass it along, now's the window. Share it if it helps, ignore it if it's not for you.</p>
  <p>This is the last you'll hear from us unless you reach out. The link below removes ${esc(org)} for good.</p>
  <p style="margin-bottom:2px;">Thanks for everything you pour into young people.</p>
  <p style="margin-bottom:2px;"><strong>Iain Deckard</strong> · It's God, Yo!</p>
  <p style="color:#555;">Reply to this email directly, it comes to me.</p>
  <hr style="border:none;border-top:1px solid #e2e2e2;margin:22px 0;"/>
  <p style="font-size:12px;color:#777;">
    It's God, Yo!™ is operated by ${esc(OUTREACH.physicalAddress)}.<br/>
    You received this because ${esc(org)} is ${areaLabelHtml} with a publicly listed youth ministry.${localSentence} We found your general contact address at ${esc(sourceNote(lead))}.${localBusiness}<br/>
    <a href="${link}" style="color:#777;">Unsubscribe (one click)</a>
  </p>
</div>`;

  const headers: Record<string, string> = {
    "List-Unsubscribe": `<${link}>, <mailto:unsubscribe@outreach.itsgodyo.com?subject=unsub-${lead.id}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };

  return { to: lead.contact_email, from: OUTREACH.from, replyTo: OUTREACH.replyTo, subject, text, html, headers };
}

/**
 * Catholic K-12 Schools SECOND touch (message_variant 'catholic_school', ~30 days
 * after the pitch). This is a DISTRIBUTION nudge, not a re-pitch or a bigger
 * discount (spec 2026-08-24): the original note reached the office, not the parents
 * who'd actually buy, so the likely reason for zero visible sign-ups is that it
 * never reached anyone who could act. So it (1) acknowledges no visible
 * participation yet, (2) makes the ask a copy-paste action with a ready-to-paste
 * newsletter/bulletin blurb, and (3) asks who the right contact is if the front
 * office isn't who handles the newsletter — so a wrong-contact problem surfaces
 * instead of silently going nowhere a second time. NO new code: APPRECIATION10
 * (10% off, through 2026-12-31) stays as-is, referenced in the blurb.
 *
 * The pasteable blurb deliberately links to the PLAIN itsgodyo.com, not the signed
 * per-lead entry URL — a newsletter blurb gets forwarded/republished, where a
 * lead-specific link would mis-attribute or leak. The email's own signup link keeps
 * the signed entry URL for per-lead attribution.
 */
export function buildSchoolsFollowupEmail(lead: OutreachLead): BuiltEmail {
  const code = VARIANT_PROFILE.catholic_school.sharedPromoCode ?? "APPRECIATION10";
  const org = lead.org_name;
  const link = unsubUrl(lead.id);
  const site = OUTREACH.appUrl;
  const siteLabel = site.replace(/^https?:\/\//, "");
  const entry = lead.campaign_id ? outreachEntryUrl(lead.id, 2, "en") : site;
  const contactNote = sourceNote(lead);

  const subject = `A quick way to get IGY in front of ${org} families`;

  const text =
`Dear ${org} Administration,

A few weeks ago I wrote about It's God, Yo!™ (IGY), our daily Bible-verse text for teens, and the 10% Catholic-school discount (code ${code}, good through December 31, 2026). I haven't seen any sign-ups from ${org} families yet, and I suspect the reason is simple: the note reached the office, but not the parents who'd actually use it.

So I wanted to make sharing it effortless. If you have a family newsletter, a PTO email, or a weekly bulletin, here's a short blurb you can paste straight in:

------------------------------------------------------------
A gift for our families from It's God, Yo!
It's God, Yo! sends your teen one Bible verse by text each day, a short verse matched to a mood or theme, in language they'll actually read. Catholic-school families get 10% off with code ${code} (good through Dec. 31, 2026). See how it works at ${siteLabel}.
------------------------------------------------------------

Two small asks:
  1. Would you be willing to drop that into your next family newsletter or bulletin?
  2. If the newsletter or bulletin is handled by someone other than the front office, a communications coordinator, PTO lead, or the advancement office, could you point me to the right person, or forward this to them? I'd rather reach whoever can actually place it than keep guessing.

That's the whole ask. No cost, no commitment, just getting it in front of families who might be glad to have it. You can see how it works at ${entry}.

With gratitude,
Iain Deckard
Founder, It's God, Yo!™
hello@itsgodyo.com

---
It's God, Yo!™ is operated by ${OUTREACH.physicalAddress}.
You received this because ${org} is a Catholic school in ${lead.state || "the United States"} with a publicly listed contact address; we found it at ${contactNote}.
Unsubscribe (one click): ${link}`;

  const html =
`<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1a1a1a;max-width:600px;margin:0 auto;">
  <p>Dear ${esc(org)} Administration,</p>
  <p>A few weeks ago I wrote about <strong>It's God, Yo!&trade;</strong> (IGY), our daily Bible-verse text for teens, and the 10% Catholic-school discount (code <strong>${esc(code)}</strong>, good through December 31, 2026). I haven't seen any sign-ups from ${esc(org)} families yet, and I suspect the reason is simple: the note reached the office, but not the parents who'd actually use it.</p>
  <p>So I wanted to make sharing it effortless. If you have a family newsletter, a PTO email, or a weekly bulletin, here's a short blurb you can paste straight in:</p>
  <div style="background:#f4f7f7;border:1px solid #d7e2e2;border-radius:8px;padding:14px 18px;margin:14px 0;">
    <p style="margin:0 0 6px;"><strong>A gift for our families from It's God, Yo!</strong></p>
    <p style="margin:0;">It's God, Yo! sends your teen one Bible verse by text each day, a short verse matched to a mood or theme, in language they'll actually read. Catholic-school families get 10% off with code <strong>${esc(code)}</strong> (good through Dec. 31, 2026). See how it works at ${esc(siteLabel)}.</p>
  </div>
  <p>Two small asks:</p>
  <ol style="padding-left:20px;">
    <li style="margin-bottom:8px;">Would you be willing to drop that into your next family newsletter or bulletin?</li>
    <li>If the newsletter or bulletin is handled by someone other than the front office, a communications coordinator, PTO lead, or the advancement office, could you point me to the right person, or forward this to them? I'd rather reach whoever can actually place it than keep guessing.</li>
  </ol>
  <p>That's the whole ask. No cost, no commitment, just getting it in front of families who might be glad to have it. You can see how it works at <a href="${esc(entry)}" style="color:#00ABBC;">${esc(siteLabel)}</a>.</p>
  <p style="margin-bottom:2px;">With gratitude,</p>
  <p style="margin-bottom:0;"><strong>Iain Deckard</strong></p>
  <p style="margin:0;color:#555;">Founder, It's God, Yo!&trade;</p>
  <p style="margin-top:2px;"><a href="mailto:hello@itsgodyo.com" style="color:#00ABBC;">hello@itsgodyo.com</a></p>
  <hr style="border:none;border-top:1px solid #e2e2e2;margin:22px 0;"/>
  <p style="font-size:12px;color:#777;">
    It's God, Yo!&trade; is operated by ${esc(OUTREACH.physicalAddress)}.<br/>
    You received this because ${esc(org)} is a Catholic school in ${esc(lead.state || "the United States")} with a publicly listed contact address; we found it at ${esc(contactNote)}.<br/>
    <a href="${link}" style="color:#777;">Unsubscribe (one click)</a>
  </p>
</div>`;

  const headers: Record<string, string> = {
    "List-Unsubscribe": `<${link}>, <mailto:unsubscribe@outreach.itsgodyo.com?subject=unsub-${lead.id}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };

  return { to: lead.contact_email, from: OUTREACH.from, replyTo: OUTREACH.replyTo, subject, text, html, headers };
}

/** Send one built email via Resend (reuses RESEND_API_KEY). Returns the provider
 *  message id on success. Throws on any non-2xx so the caller can record failure
 *  without advancing the lead. */
export async function sendViaResend(email: BuiltEmail, idempotencyKey?: string): Promise<{ id: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY not set");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from: email.from,
      to: [email.to],
      reply_to: email.replyTo,
      subject: email.subject,
      text: email.text,
      html: email.html,
      headers: email.headers,
    }),
  });
  if (!res.ok) throw new Error(`resend_${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json().catch(() => ({}))) as { id?: string };
  return { id: body.id ?? "unknown" };
}
