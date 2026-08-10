import type { Metadata } from "next";
import Wordmark from "@/components/Wordmark";
import BubbleMark from "@/components/BubbleMark";
import { PURCHASES_ENABLED, CORNERSTONE_ENABLED } from "@/lib/flags";
import { getSampleVerses } from "@/lib/sampleVerses";
import s from "./sample.module.css";
import ConversionView from "@/components/ConversionView";

export const metadata: Metadata = {
  title: "See a real sample | It's God, Yo!™",
  description:
    "Real daily verses we've already sent, in the exact voice we text them. No signup, nothing to enter. See what It's God, Yo actually feels like.",
};

// Reshuffles a fresh spread of already-approved verses on every load. Low-traffic
// marketing surface; keeping it dynamic is what makes "reload for a new set" work.
export const dynamic = "force-dynamic";

const SIGNUP_OPEN = PURCHASES_ENABLED;

/**
 * Public, zero-friction sample page. Shows a handful of already-approved, already-live
 * daily-verse paraphrases (the same content the daily send pulls) so someone with no
 * account can see what It's God, Yo feels like before paying. No signup, no email
 * capture, no gate. Reads two safe columns server-side; touches no billing / SMS.
 */
export default async function SamplePage() {
  const verses = await getSampleVerses(6);

  return (
    <div className={s.page}>
      <ConversionView event="sample_viewed" />
      <header className={s.header}>
        <div className={s.navbar}>
          <a className={s.navHome} href="/">Home</a>
          <nav className={s.navlinks}>
            <a href="/#how">How it works</a>
            <a href="/#pricing">Pricing</a>
            {SIGNUP_OPEN
              ? <a href="/signup" className={s.btnWhite}>Get started</a>
              : <span className={s.btnWhite} style={{ opacity: 0.55, cursor: "not-allowed" }} aria-disabled="true">Coming soon</span>}
          </nav>
        </div>
      </header>

      <main className={s.wrap}>
        <div className={s.wordmarkMsg}>
          <Wordmark tone="brass" />
        </div>

        <div className={s.intro}>
          <div className={s.eyebrow}>SEE IT FOR REAL</div>
          <h1 className={s.h1}>This is what lands on their phone.</h1>
          <p className={s.sub}>
            A curated set of real, human-approved messages in the exact voice we text them.
            No signup and nothing to enter. Reload for a fresh set.
          </p>
        </div>

        {verses.length === 0 ? (
          <p className={s.empty}>Fresh samples are on the way. Check back in a moment.</p>
        ) : (
          <div className={s.thread}>
            <div className={s.threadHead}>
              <BubbleMark size={38} className={s.avatar} title="It's God, Yo" />
              <div>
                <div className={s.threadName}>It&rsquo;s God, Yo</div>
                <div className={s.threadMeta}>Real messages &middot; grounded in the King James Version</div>
              </div>
              <span className={s.liveTag}><span className={s.livePulse} aria-hidden="true" />APPROVED</span>
            </div>

            {verses.map((v, i) => (
              <div key={i} className={s.msgRow}>
                <div className={s.bubbleIn}>{v.text}</div>
                {v.verseRef && <div className={s.cite}>{v.verseRef}</div>}
              </div>
            ))}
          </div>
        )}

        <div className={s.ctaRow}>
          {SIGNUP_OPEN
            ? <a href="/signup" className={s.btnBlue}>Start your daily verse &rarr;</a>
            : <span className={s.btnBlue} style={{ opacity: 0.55, cursor: "not-allowed" }} aria-disabled="true">Coming soon</span>}
          <a href="/sample" className={s.btnOutline}>Shuffle again &#8635;</a>
          <a href="/" className={s.btnGhost}>Back to home</a>
        </div>

        <p className={s.fineprint}>
          Every message is grounded in the King James Version, a public domain text. One text a
          day. That&rsquo;s the whole thing.
        </p>
      </main>

      <footer className={s.footer}>
        <div className={`${s.wrap} ${s.footerRow}`}>
          <span>&copy; 2026 Deckard Enterprise International, LLC</span>
          <div className={s.footerLinks}>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            <a href="/its-okay-to-not-be-okay" className={s.gold}>It&rsquo;s okay to not be okay</a>
            {(CORNERSTONE_ENABLED || SIGNUP_OPEN) && <a href="/program-terms">Program Terms</a>}
          </div>
        </div>
      </footer>
    </div>
  );
}
