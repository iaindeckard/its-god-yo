"use client";

import { useState } from "react";
import Wordmark from "./Wordmark";
import SponsorRotator from "./SponsorRotator";
import { PURCHASES_ENABLED, SPANISH_ENABLED } from "@/lib/flags";
import s from "./landing.module.css";

type Audience = "parent" | "teen";

const CONTENT: Record<Audience, {
  headline: string; // may contain <br>
  subhead: string;
  cta: string;
  fineprint: string;
  navCta: string;
  switchLabel: string;
  step1: string;
  step2: string;
}> = {
  parent: {
    headline: "A daily verse,<br>texted the way<br>they&rsquo;d actually read it.",
    subhead:
      "Send your teen scripture rendered as short casual messages that sound like a friend, not a lecture. One a day, in English or Spanish.",
    cta: "Get started",
    fineprint: "No charge until your teen texts back YES. Cancel anytime.",
    navCta: "Get started",
    switchLabel: "Not a parent?",
    step1: "Choose who gets the daily text: yourself, your teen, or a gift for someone else.",
    step2: "The recipient gets a text and has to reply YES themselves. No card is charged until they do.",
  },
  teen: {
    headline: "A daily verse,<br>texted the way<br>you&rsquo;d actually read it.",
    subhead:
      "Scripture, rendered as short casual messages that sound like a friend, not a lecture. One a day, in English or Spanish.",
    cta: "Show a parent",
    fineprint: "A parent or guardian sets this up and pays. You just have to reply YES to start.",
    navCta: "Show a parent",
    switchLabel: "Not a teen?",
    step1: "A parent or guardian picks a plan. You get the text once you confirm.",
    step2: "You get a text and reply YES yourself. Nothing starts until you do.",
  },
};

/** The bubble-message wordmark used at the top of the gate and hero. */
function WordmarkBubble() {
  return (
    <div className={s.wordmarkMsg}>
      <Wordmark tone="brass" />
    </div>
  );
}

export default function Landing() {
  const [audience, setAudience] = useState<Audience | null>(null);
  const [showShare, setShowShare] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showVerse, setShowVerse] = useState(false);

  const c = audience ? CONTENT[audience] : null;

  const shareUrl = "https://its-god-yo.vercel.app";
  const shareText = "Check out It's God, Yo — a daily scripture text in language that actually lands. A parent sets it up:";
  const smsHref = `sms:?&body=${encodeURIComponent(`${shareText} ${shareUrl}`)}`;
  const mailHref = `mailto:?subject=${encodeURIComponent("It's God, Yo — daily scripture text")}&body=${encodeURIComponent(`${shareText}\n\n${shareUrl}`)}`;

  function handleCta() {
    if (audience === "parent") {
      if (!PURCHASES_ENABLED) return; // signups temporarily closed — no checkout
      window.location.href = "/signup";
      return;
    }
    // teen: real "show a parent" mechanism — native share if available, else the panel
    if (typeof navigator !== "undefined" && navigator.share) {
      navigator.share({ title: "It's God, Yo", text: shareText, url: shareUrl }).catch(() => setShowShare(true));
    } else {
      setShowShare(true);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setShowShare(true);
    }
  }

  // ----- Gate screen -----
  if (!audience) {
    return (
      <div className={s.page}>
        <div className={s.gate}>
          <div className={`${s.wordmarkMsg} ${s.gateReceived}`}>
            <Wordmark tone="brass" />
          </div>
          <div className={s.gateQuestion}>Who&rsquo;s here today?</div>
          <div className={s.gateSub}>We&rsquo;ll tailor everything on this site to you, so it actually makes sense.</div>
          <div className={s.gateChoices}>
            <button className={s.gateCard} onClick={() => setAudience("parent")}>
              <div className={s.gateIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
              </div>
              <div className={s.gateCardTitle}>I&rsquo;m a parent or caregiver</div>
              <div className={s.gateCardBody}>Set up and pay for a daily scripture text for your teen.</div>
            </button>
            <button className={s.gateCard} onClick={() => setAudience("teen")}>
              <div className={s.gateIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="5" /><path d="M20 21a8 8 0 0 0-16 0" /></svg>
              </div>
              <div className={s.gateCardTitle}>I&rsquo;m a teen</div>
              <div className={s.gateCardBody}>See what it is, then loop in a parent or guardian to set it up.</div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ----- Site -----
  return (
    <div className={s.page}>
      <header className={s.header}>
        <div className={s.navbar}>
          <button className={s.navHome} onClick={() => { setAudience(null); setShowShare(false); }}>Home</button>
          <nav className={s.navlinks}>
            <a href="#how">How it works</a>
            <a href="#pricing">Pricing</a>
            <a href="/its-okay-to-not-be-okay" className={s.iotnbo}>&#10084; It&rsquo;s okay to not be okay</a>
            {SPANISH_ENABLED && <a href="/?lang=es" className={s.lang}>Espa&ntilde;ol</a>}
            <button className={s.switch} onClick={() => setAudience(audience === "parent" ? "teen" : "parent")}>{c!.switchLabel}</button>
            {audience === "parent"
              ? (PURCHASES_ENABLED
                  ? <a href="/signup" className={s.btnWhite}>{c!.navCta}</a>
                  : <span className={s.btnWhite} style={{ opacity: 0.55, cursor: "not-allowed" }} aria-disabled="true">Coming soon</span>)
              : <button className={s.btnWhite} onClick={handleCta}>{c!.navCta}</button>}
          </nav>
        </div>
      </header>

      <div className={`${s.wrap} ${s.heroWordmarkRow}`}>
        <WordmarkBubble />
      </div>

      <section className={`${s.wrap} ${s.hero}`}>
        <div>
          <div className={s.eyebrow}>FAITH THAT FITS IN A TEXT</div>
          <h1 dangerouslySetInnerHTML={{ __html: c!.headline }} />
          <p className={s.subhead}>{c!.subhead}</p>
          <div className={s.ctaRow}>
            {audience === "parent" && !PURCHASES_ENABLED
              ? <button className={s.btnBlue} disabled style={{ opacity: 0.55, cursor: "not-allowed" }}>Coming soon</button>
              : <button className={s.btnBlue} onClick={handleCta}>{c!.cta}</button>}
            <a href="#pricing" className={s.btnOutline}>See pricing</a>
          </div>
          <div className={s.fineprint}>
            {audience === "parent" && !PURCHASES_ENABLED
              ? "Signups aren't open just yet — you can look around, but you can't be charged. Check back soon."
              : c!.fineprint}
          </div>

          {audience === "teen" && showShare && (
            <div className={s.sharePanel}>
              <div className={s.sharePanelTitle}>Send this to a parent or guardian</div>
              <div className={s.sharePanelSub}>They set it up and pay — you just reply YES when your text arrives.</div>
              <div className={s.shareBtns}>
                <a className={s.shareBtn} href={smsHref}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                  Text a parent
                </a>
                <a className={s.shareBtn} href={mailHref}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 5L2 7" /></svg>
                  Email a parent
                </a>
                <button className={s.shareBtn} onClick={copyLink} type="button">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                  Copy link
                </button>
              </div>
              {copied && <div className={s.shareCopied}>Link copied — paste it wherever you talk to them.</div>}
            </div>
          )}
        </div>

        <div className={s.smsCard}>
          <div className={s.smsLabel}>Today &middot; Psalm 46:10</div>
          <div className={s.smsBubble}>chill for a sec and just KNOW i&rsquo;m God, i got this. the whole world, all of it</div>
          <button className={s.smsVerseLink} onClick={() => setShowVerse((v) => !v)} type="button" style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0 }}>
            {showVerse ? "Hide full verse" : "Read Psalm 46:10 in full"} &rarr;
          </button>
          {showVerse && (
            <p style={{ fontSize: 13, color: "#a9bad6", lineHeight: 1.6, marginTop: 10 }}>
              &ldquo;Be still, and know that I am God: I will be exalted among the heathen, I will be exalted in the earth.&rdquo;
              <br /><span style={{ color: "#7686a0" }}>— Psalm 46:10, King James Version (public domain)</span>
            </p>
          )}
        </div>
      </section>

      <section className={s.sectionDark} id="how">
        <div className={s.wrap}>
          <div className={s.eyebrow}>HOW IT WORKS</div>
          <div className={s.steps}>
            <div>
              <div className={s.stepIcon}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="4" width="14" height="17" rx="2" /><line x1="9" y1="9" x2="15" y2="9" /><line x1="9" y1="13" x2="15" y2="13" /></svg></div>
              <div className={s.stepTitle}>Pick a plan</div>
              <div className={s.stepBody}>{c!.step1}</div>
            </div>
            <div>
              <div className={s.stepIcon}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-1 4 8.5 8.5 0 0 1-7.5 4.5 8.4 8.4 0 0 1-4-1L3 20l1-5.5a8.4 8.4 0 0 1-1-4 8.5 8.5 0 0 1 4.5-7.5 8.4 8.4 0 0 1 4-1h.5a8.5 8.5 0 0 1 8 8v.5z" /><path d="M9 12l2 2 4-4" /></svg></div>
              <div className={s.stepTitle}>They confirm</div>
              <div className={s.stepBody}>{c!.step2}</div>
            </div>
            <div>
              <div className={s.stepIcon}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="5" width="16" height="16" rx="2" /><line x1="4" y1="10" x2="20" y2="10" /><line x1="8" y1="3" x2="8" y2="7" /><line x1="16" y1="3" x2="16" y2="7" /></svg></div>
              <div className={s.stepTitle}>One text a day</div>
              <div className={s.stepBody}>A short, real scripture message shows up daily. No app, no account to check.</div>
            </div>
          </div>
        </div>
      </section>

      <section className={s.sectionPlain}>
        <div className={s.wrap}>
          <div className={s.eyebrow}>WHICH TEXT WE USE</div>
          <p className={s.translationCopy}>
            Full transparency: every English message is grounded in the King James Version. Every Spanish message is grounded in the Reina-Valera 1909 revision. Both are public domain texts, so there&rsquo;s no copyrighted translation being licensed or infringed here, and there never will be.
          </p>
          <div className={s.badges}>
            <div className={s.badge}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
              <div><div className={s.label}>English</div><div className={s.value}>King James Version (public domain)</div></div>
            </div>
            {SPANISH_ENABLED && (
            <div className={s.badge}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
              <div><div className={s.label}>Espa&ntilde;ol</div><div className={s.value}>Reina-Valera 1909 (dominio p&uacute;blico)</div></div>
            </div>
            )}
          </div>
        </div>
      </section>

      <section className={`${s.wrap} ${s.pricingSection}`} id="pricing">
        <div className={s.eyebrow}>PRICING</div>
        <div className={s.pricingGrid}>
          <div className={s.priceCard}>
            <div className={s.pricePlan}>Individual</div>
            <div className={s.priceAmount}>$6.99<span>/mo</span></div>
            <div className={s.priceNote}>One teen, billed monthly.</div>
          </div>
          <div className={`${s.priceCard} ${s.featured}`}>
            <div className={s.priceTag}>Best value</div>
            <div className={s.pricePlan}>Individual annual</div>
            <div className={s.priceAmount}>$59<span>/yr</span></div>
            <div className={s.priceNote}>One teen, billed once a year.</div>
          </div>
          <div className={s.priceCard}>
            <div className={s.pricePlan}>Family</div>
            <div className={s.priceAmount}>$99<span>/yr</span></div>
            <div className={s.priceNote}>Covers up to 2 teens.</div>
            <div className={s.priceExtra}>+$28/yr for each additional teen</div>
          </div>
          <div className={s.priceCard}>
            <div className={s.pricePlan}>Gift</div>
            <div className={s.priceAmount}>$59<span>/yr</span></div>
            <div className={s.priceNote}>Send it to someone else, one teen.</div>
          </div>
        </div>
      </section>

      <section className={s.sectionPlain}>
        <div className={s.wrap}>
          <div className={s.eyebrow}>WHY WE DO THIS</div>
          <h2 className={s.whyHeadline}>Every child deserves to hear it.</h2>
          <p className={s.translationCopy}>
            Every generation gets its own slang. The Bible wasn&rsquo;t written in ours &mdash; it was Hebrew, Greek, Latin, Old English, whatever the moment called for. Somebody was always translating the delivery, never the message. We&rsquo;re doing the same thing, just for right now. Teens who need the Word but don&rsquo;t always take to how it&rsquo;s usually said deserve the same shot at hearing it as anyone else. That&rsquo;s the whole point of Yo.
          </p>
          <div className={s.whyCards}>
            <div className={s.whyCard}>
              <div className={s.whyCardTitle}>Every teen gets their own week</div>
              <div className={s.whyCardBody}>Free trials run on each teen&rsquo;s own clock, not the family&rsquo;s. If that means a few bonus days floating around, so be it. Bonus God is bonus good.</div>
            </div>
            <div className={s.whyCard}>
              <div className={s.whyCardTitle}>We&rsquo;d rather lose a little money</div>
              <div className={s.whyCardBody}>If someone finds a way to stretch the system, let them. We&rsquo;ll sleep fine knowing the Word reached someone who needed it. And if it happens, we forgive that too.</div>
            </div>
          </div>
        </div>
      </section>

      <section className={s.iotnboSection}>
        <div className={s.wrap}>
          <div className={s.iotnboBanner}>
            <div className={s.iotnboLeft}>
              <div className={s.iotnboIcon}>&#10084;</div>
              <div>
                <div className={s.iotnboTitle}>It&rsquo;s okay to not be okay.</div>
                <div className={s.iotnboBody}>If you or someone you know is struggling, real support and resources are one tap away.</div>
              </div>
            </div>
            <a href="/its-okay-to-not-be-okay" className={s.btnGold}>Get support</a>
          </div>
        </div>
      </section>

      {/* Sponsor rotator — renders only when there are active sponsors. */}
      <SponsorRotator />

      <footer className={s.footer}>
        <div className={`${s.wrap} ${s.footerRow}`}>
          <span>&copy; 2026 Deckard Enterprise International, LLC</span>
          <div className={s.footerLinks}>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            <a href="/cookies">Cookies</a>
            <a href="/its-okay-to-not-be-okay" className={s.gold}>It&rsquo;s okay to not be okay</a>
            <a href="/sponsors">Sponsors</a>
            <a href="/sponsor-inquiry">Interested in sponsoring?</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
