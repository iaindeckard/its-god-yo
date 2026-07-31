import type { Metadata } from "next";
import s from "./iotnbo.module.css";

export const metadata: Metadata = {
  title: "It's Okay to Not Be Okay — It's God, Yo!™",
  description:
    "A message from the founder of It's God, Yo about mental health, the pressure teens and the adults who love them face, and why asking for help matters — with free, confidential crisis resources.",
};

/**
 * The real "It's okay to not be okay" page — copy is LOCKED
 * (IGY-IOTNBO-LOCKED-COPY-2026-07-22.md) and reproduced verbatim. This is real,
 * sensitive personal content (the founder's account of losing his wife to
 * suicide); the tone stays sincere throughout — no brand-voice/slang here.
 *
 * Build-note constraints held to exactly: NO personal email or phone number
 * anywhere on the page; all four crisis resources (988, Crisis Text Line, AFSP,
 * IASP) kept as the real safety infrastructure; styled with IGY's own
 * eyebrow/headline conventions rather than USN's visual styling.
 */
export default function ItsOkayPage() {
  return (
    <main className={s.page}>
      <section className={`${s.wrap} ${s.hero}`}>
        <div className={s.eyebrow}>Mental Health</div>
        <h1>It&rsquo;s okay to not be okay.</h1>
        <p className={s.lead}>
          Behind every smile, every &ldquo;I&rsquo;m fine,&rdquo; every quiet kid in the back of the room, there is a
          person. And sometimes that person is struggling in ways nobody can see.
        </p>
      </section>

      <section className={s.wrap}>
        <div className={s.card}>
          <div className={s.founderTag}>A Message From Our Founder</div>
          <p className={s.strong}>
            In February of 2025, Lisette and I celebrated our 20-year wedding anniversary. On July 11, 2025, I lost her
            to suicide.
          </p>
          <p>
            I was devastated. I still am. And one of the hardest parts is that I didn&rsquo;t know how much she was
            hurting. She didn&rsquo;t say. People often don&rsquo;t.
          </p>
          <p>
            That&rsquo;s not weakness. That&rsquo;s what happens when the world tells you to be strong, to push through,
            to keep going. We learn to wear the mask so well that even the people closest to us can&rsquo;t see behind
            it.
          </p>
          <p>
            I built It&rsquo;s God, Yo because I believe every teen deserves to hear something true and steady in their
            day, and I want this to be a place where struggling is never something to hide. Whether you&rsquo;re the
            parent setting this up or the teen receiving it, that&rsquo;s true for you too.
          </p>
        </div>
      </section>

      <section className={s.wrap}>
        <div className={s.sectionLabel}>The pressure teens face (and the adults who love them)</div>
        <div className={s.body}>
          <p>
            Think about what being a teenager actually looks like right now. School. Friendships that shift overnight.
            Social media that never turns off. Family expectations. Trying to figure out who you are while
            everyone&rsquo;s watching. And often, right underneath it: not enough sleep, not enough space to just be.
          </p>
          <p>
            There is almost no room to say <em>&ldquo;I&rsquo;m not okay.&rdquo;</em>
          </p>
          <p>
            The culture around growing up rewards looking fine. It rewards keeping it together. So teens learn to carry
            whatever they&rsquo;re carrying alone, and sometimes the weight becomes impossible. The same is often true
            for the parents raising them.
          </p>
          <p>
            You never know what someone is going through. The kid who seems fine. The one who always has a joke ready.
            The quiet one who hasn&rsquo;t said much lately. The person you haven&rsquo;t checked in on in a while.
          </p>
          <div className={s.callout}>
            <p>
              &ldquo;Are you really okay?&rdquo;
              <br />
              <span className={s.accent}>Ask the question. Accept the answer.</span>
            </p>
          </div>
          <p>
            Asking for help is not weakness. It is one of the hardest, most courageous things a person can do, and it is
            always worth doing. There is no shame in struggling. There is no shame in needing support. There is only
            shame in a world that made you feel like you had to hide it.
          </p>
        </div>
      </section>

      <section className={s.wrap}>
        <div className={s.sectionLabel}>You are not alone</div>
        <p className={s.lead} style={{ marginBottom: 28 }}>
          If you are struggling, or someone you know is, please reach out. These resources are free, confidential, and
          available right now.
        </p>
        <div className={s.resourceGrid}>
          <div className={s.resource}>
            <h3>988 Suicide &amp; Crisis Lifeline</h3>
            <p>
              Call or text <strong>988</strong> from anywhere in the US. Available 24 hours a day, 7 days a week. Free
              and confidential.
            </p>
            <a href="https://988lifeline.org" target="_blank" rel="noopener noreferrer">988lifeline.org &rarr;</a>
          </div>
          <div className={s.resource}>
            <h3>Crisis Text Line</h3>
            <p>
              Text <strong>HOME to 741741</strong> to connect with a trained crisis counselor. Available 24/7.
            </p>
            <a href="https://www.crisistextline.org" target="_blank" rel="noopener noreferrer">crisistextline.org &rarr;</a>
          </div>
          <div className={s.resource}>
            <h3>American Foundation for Suicide Prevention</h3>
            <p>
              Education, research, and support for those affected by suicide. Resources for survivors, families, and
              those who want to help.
            </p>
            <a href="https://afsp.org" target="_blank" rel="noopener noreferrer">afsp.org &rarr;</a>
          </div>
          <div className={s.resource}>
            <h3>Outside the US</h3>
            <p>
              Crisis support is available in most countries. Find your local helpline through the International
              Association for Suicide Prevention.
            </p>
            <a href="https://www.iasp.info" target="_blank" rel="noopener noreferrer">iasp.info &rarr;</a>
          </div>
        </div>
        <div className={s.closing}>
          <p>
            If you&rsquo;re not ready to call a hotline, that&rsquo;s okay too. Talk to someone you trust, a parent, a
            friend, a pastor, a counselor, anyone who&rsquo;s actually in your corner. You don&rsquo;t have to carry this
            alone, and you don&rsquo;t have to figure out who to tell all by yourself either.
          </p>
          <p className={s.stay}>The world is not better without you. We need you to stay with us.</p>
        </div>
      </section>

      <div className={`${s.wrap} ${s.foot}`}>
        <a href="/">&larr; Back home</a>
      </div>
    </main>
  );
}
