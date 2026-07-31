import type { Metadata } from "next";
import { getActiveSponsors, type PublicSponsor } from "@/lib/sponsors";
import s from "./sponsors.module.css";

export const metadata: Metadata = {
  title: "Our sponsors — It's God, Yo!™",
  description: "The faith-aligned organizations who help make It's God, Yo possible.",
};

export const dynamic = "force-dynamic";

/**
 * Static "thank-you" page — a dignified, PBS-style "made possible by" grid of
 * every active sponsor at once. Zero motion, every logo the same size, no tiers.
 * Headline "We couldn't do it without you" is locked; the rest of the copy is a
 * PLACEHOLDER pending final wording.
 */
export default async function SponsorsPage() {
  let sponsors: PublicSponsor[] = [];
  try {
    sponsors = await getActiveSponsors();
  } catch {
    sponsors = [];
  }

  return (
    <main className={s.page}>
      <div className={s.wrap}>
        <div className={s.eyebrow}>OUR SPONSORS</div>
        <h1 className={s.headline}>We couldn&rsquo;t do it without you.</h1>
        <p className={s.sub}>It&rsquo;s God, Yo runs because people who believe in this work choose to support it directly. Every name and logo below is one of them.</p>

        {sponsors.length === 0 ? (
          <p className={s.empty}>Our sponsor list is being updated — check back soon.</p>
        ) : (
          <div className={s.grid}>
            {sponsors.map((sp) => (
              <div key={sp.id} className={s.cell}>
                <img src={sp.logo_url} alt={sp.name} className={s.logo} />
              </div>
            ))}
          </div>
        )}

        <div className={s.footerLinks}>
          <a href="/">&larr; Back home</a>
          <a href="/sponsor-inquiry">Interested in sponsoring?</a>
        </div>
      </div>
    </main>
  );
}
