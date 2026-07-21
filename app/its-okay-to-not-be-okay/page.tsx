import type { Metadata } from "next";
import s from "./iotnbo.module.css";

export const metadata: Metadata = {
  title: "It's Okay to Not Be Okay — It's God, Yo!",
  description:
    "A message from It's God, Yo founder Iain Deckard about mental health, the pressure young people face, and why asking for help matters — with free, confidential crisis resources.",
};

/**
 * Adapted from USN's "It's okay to not be okay" page for IGY. The founder's
 * personal message is preserved faithfully; the athlete framing is reframed for
 * young people; USN emails/roadmap swapped for IGY. No phone number appeared in
 * the source. NOTE: USN's "email me and I'll call you" personal offer was
 * intentionally NOT carried over verbatim — for a teen audience that's reframed
 * toward a trusted adult + the professional crisis lines (flagged to Iain).
 */
export default function ItsOkayPage() {
  return (
    <main className={s.page}>
      <section className={`${s.wrap} ${s.hero}`}>
        <div className={s.eyebrow}>Mental Health Matters</div>
        <h1>It&rsquo;s Okay to <span className={s.teal}>Not Be Okay.</span></h1>
        <p className={s.lead}>
          Behind every group chat, every posted highlight, every &ldquo;I&rsquo;m fine,&rdquo; there is a person. And sometimes that person is struggling in ways nobody can see.
        </p>
      </section>

      <section className={s.wrap}>
        <div className={s.card}>
          <div className={s.founderTag}>A Message from Our Founder</div>
          <p className={s.strong}>
            In February of 2025, my wife Lisette and I celebrated our 20-year wedding anniversary. On July 11, 2025, I lost her to suicide.
          </p>
          <p>
            I was devastated. I still am. And one of the hardest parts is that I didn&rsquo;t know how much she was hurting. She didn&rsquo;t say. People often don&rsquo;t.
          </p>
          <p>
            That&rsquo;s not weakness. That&rsquo;s what happens when the world tells you to be strong, to push through, to keep going. We learn to wear the mask so well that even the people closest to us can&rsquo;t see behind it.
          </p>
          <p>
            I built It&rsquo;s God, Yo because young people deserve to hear the truth, gently, and in language that actually sounds like them. And the truth is that mental health matters, whether anyone wants to talk about it or not. I want this to be a place where that conversation is not only allowed, but welcomed.
          </p>
          <div className={s.sig}>&mdash; Iain Deckard, Founder, It&rsquo;s God, Yo!</div>
        </div>
      </section>

      <section className={s.wrap}>
        <div className={s.divider}><span className={s.line} /><span>The Pressure Young People Face</span><span className={s.line} /></div>
        <div className={s.body}>
          <p>
            Think about what a young person&rsquo;s life actually looks like right now. School. Grades. Practice. A phone that never stops. A feed full of everyone else&rsquo;s highlight reel. Expectations from family, from friends, from a version of themselves they think they&rsquo;re supposed to be.
          </p>
          <p>
            There is almost no space to say <em>&ldquo;I&rsquo;m not okay.&rdquo;</em>
          </p>
          <p>
            So much of the world rewards looking like you have it together. It punishes vulnerability, not always openly, but in the comments, the group chats, the quiet comparisons. So kids learn to carry whatever they&rsquo;re carrying alone. And sometimes the weight becomes impossible.
          </p>
          <p>
            You never know what someone is going through. The friend who seems fine. The one everybody thinks is thriving. The quiet one. The person you haven&rsquo;t checked in on in a while.
          </p>
          <div className={s.callout}>
            <p>&ldquo;Are you really okay?&rdquo;<br /><span className={s.accent}>Ask the question. Accept the answer.</span></p>
          </div>
          <p>
            Asking for help is not weakness. It is one of the hardest, most courageous things a person can do, and it is always worth doing. There is no shame in struggling. There is no shame in needing support. There is only shame in a world that made you feel like you had to hide it.
          </p>
        </div>
      </section>

      <section className={s.wrap}>
        <div className={s.divider}><span className={s.line} /><span>You Are Not Alone</span><span className={s.line} /></div>
        <p className={s.lead} style={{ marginBottom: 28 }}>
          If you are struggling, or someone you know is, please reach out. These resources are free, confidential, and available right now.
        </p>
        <div className={s.resourceGrid}>
          <div className={s.resource}>
            <div className={s.emoji} aria-hidden="true">&#128222;</div>
            <h3>988 Suicide &amp; Crisis Lifeline</h3>
            <p>Call or text <strong>988</strong> from anywhere in the US. Available 24 hours a day, 7 days a week. Free and confidential.</p>
            <a href="https://988lifeline.org" target="_blank" rel="noopener noreferrer">988lifeline.org &rarr;</a>
          </div>
          <div className={s.resource}>
            <div className={s.emoji} aria-hidden="true">&#128172;</div>
            <h3>Crisis Text Line</h3>
            <p>Text <strong>HOME to 741741</strong> to connect with a trained crisis counselor. Available 24/7.</p>
            <a href="https://www.crisistextline.org" target="_blank" rel="noopener noreferrer">crisistextline.org &rarr;</a>
          </div>
          <div className={s.resource}>
            <div className={s.emoji} aria-hidden="true">&#129525;</div>
            <h3>American Foundation for Suicide Prevention</h3>
            <p>Education, research, and support for those affected by suicide. Resources for survivors, families, and those who want to help.</p>
            <a href="https://afsp.org" target="_blank" rel="noopener noreferrer">afsp.org &rarr;</a>
          </div>
          <div className={s.resource}>
            <div className={s.emoji} aria-hidden="true">&#127757;</div>
            <h3>Outside the US</h3>
            <p>Crisis support is available in most countries. Find your local helpline through the International Association for Suicide Prevention.</p>
            <a href="https://www.iasp.info/resources/Crisis_Centres/" target="_blank" rel="noopener noreferrer">iasp.info &rarr;</a>
          </div>
        </div>
        <div className={s.closing}>
          <p className={s.em}>You don&rsquo;t have to have the words figured out.</p>
          <p>Tell a parent, a guardian, a teacher, a coach, a pastor &mdash; any adult you trust. &ldquo;I&rsquo;m not okay&rdquo; is enough. And if you need to talk to someone right now, you don&rsquo;t have to wait:</p>
          <a className={s.email} href="tel:988">Call or text 988 &mdash; the Suicide &amp; Crisis Lifeline</a>
          <p style={{ marginTop: 14 }}>Free, confidential, and available 24 hours a day, 7 days a week.</p>
          <p className={s.stay}>The world is not better without you. We need you to stay with us.</p>
        </div>
      </section>

      <div className={`${s.wrap} ${s.foot}`}>
        <a href="/">&larr; Back home</a>
      </div>
    </main>
  );
}
