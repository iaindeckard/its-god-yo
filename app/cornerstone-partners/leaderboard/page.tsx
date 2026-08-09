import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CORNERSTONE_ENABLED } from "@/lib/flags";
import { getCornerstoneLeaderboard, displayPartnerNumber } from "@/lib/cornerstone";
import s from "./leaderboard.module.css";

export const metadata: Metadata = {
  title: "Cornerstone Partner Leaderboard | It's God, Yo!™",
  description:
    "Churches recognized as Cornerstone Partners of It's God, Yo, ranked by the teenagers they've helped connect to Scripture.",
};

export const dynamic = "force-dynamic";

/**
 * Public Cornerstone Partner leaderboard. Gated by CORNERSTONE_ENABLED. Shows only
 * churches opted into public listing (public_listing_status = 'listed'), ranked by
 * their PAST-TRIAL conversions — teens they referred whose subscription has a real
 * settled recurring charge (not merely nominally 'active' during the free trial).
 * See getCornerstoneLeaderboard(). Name + count only; no contact/billing fields.
 */
export default async function CornerstoneLeaderboardPage() {
  if (!CORNERSTONE_ENABLED) notFound();

  const rows = await getCornerstoneLeaderboard();
  const ranked = rows.filter((r) => r.count > 0);

  return (
    <main className={s.page}>
      <div className={s.wrap}>
        <div className={s.head}>
          <div className={s.eyebrow}>Cornerstone Partners&trade;</div>
          <h1 className={s.headline}>Leaderboard</h1>
          <p className={s.sub}>
            These churches are recognized as Cornerstone Partners of It&rsquo;s God, Yo! and ranked by the number of
            teenagers they&rsquo;ve helped connect to Scripture beyond a free trial.
          </p>
        </div>

        {ranked.length === 0 ? (
          <p className={s.empty}>The leaderboard will fill in as churches start bringing teens on board.</p>
        ) : (
          <ol className={s.board}>
            {ranked.map((r, i) => (
              <li key={r.partnerNumber} className={s.row}>
                <span className={s.rank}>{i + 1}</span>
                <span className={s.church}>
                  <span className={s.name}>{r.churchName}</span>
                  <span className={s.partner}>{displayPartnerNumber(r.partnerNumber)}</span>
                </span>
                <span className={s.count}>
                  <span className={s.countNum}>{r.count.toLocaleString()}</span>
                  <span className={s.countLabel}>{r.count === 1 ? "teen" : "teens"}</span>
                </span>
              </li>
            ))}
          </ol>
        )}

        <div className={s.links}>
          <a href="/cornerstone-partners" className={s.dirLink}>See all Cornerstone Partners →</a>
        </div>

        <div className={s.cta}>
          <div className={s.ctaTitle}>Is your church a founding supporter?</div>
          <div className={s.ctaSub}>Churches that join during the founding stage are permanently recognized as Cornerstone Partners.</div>
          <a href="/cornerstone" className={s.ctaBtn}>Become a Cornerstone Partner</a>
        </div>
      </div>
    </main>
  );
}
