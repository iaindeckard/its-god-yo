import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CORNERSTONE_ENABLED } from "@/lib/flags";
import { listPublicCornerstonePartners, directoryFacets, filterDirectory, toGlobePoints } from "@/lib/cornerstone";
import PartnerGlobe from "./PartnerGlobe";
import s from "./cornerstone-partners.module.css";

export const metadata: Metadata = {
  title: "Cornerstone Partners — It's God, Yo!™",
  description: "The churches recognized as Cornerstone Partners of It's God, Yo — founding supporters helping keep teenagers connected to Scripture.",
};

export const dynamic = "force-dynamic";

/**
 * Public Cornerstone Partners directory. Gated by CORNERSTONE_ENABLED. Shows only
 * churches opted into public listing, and only safe fields (name, city/state,
 * country, website, authorized logo, partner number, year joined) — no contact
 * details, youth-group size, billing, or notes are ever fetched here. Basic
 * country/state/year filters; no map, no free-text search.
 */
export default async function CornerstonePartnersPage({
  searchParams,
}: {
  searchParams: Promise<{ country?: string; state?: string; year?: string }>;
}) {
  if (!CORNERSTONE_ENABLED) notFound();
  const sp = await searchParams;

  const all = await listPublicCornerstonePartners();
  const facets = directoryFacets(all);
  const yearNum = sp.year && /^\d{4}$/.test(sp.year) ? Number(sp.year) : null;
  const filters = { country: sp.country || null, stateProvince: sp.state || null, year: yearNum };
  const shown = filterDirectory(all, filters);
  const filtered = !!(filters.country || filters.stateProvince || filters.year);
  // Globe points = the SAME set shown in the list below (safe fields + resolved
  // coordinates; real geocode, else country-centroid). Kept in lockstep with the list.
  const points = toGlobePoints(shown);

  return (
    <main className={s.page}>
      <div className={s.wrap}>
        <div className={s.head}>
          <div className={s.eyebrow}>Cornerstone Partners</div>
          <h1 className={s.headline}>The churches who helped build this</h1>
          <p className={s.sub}>
            These churches joined during the founding stage of It&rsquo;s God, Yo! and are permanently recognized as
            Cornerstone Partners &mdash; helping keep teenagers connected to Scripture between Sundays.
          </p>
        </div>

        {all.length > 0 && (
          <form method="get" className={s.filters}>
            <div className={s.field}>
              <label htmlFor="country">Country</label>
              <select id="country" name="country" defaultValue={sp.country ?? ""}>
                <option value="">All countries</option>
                {facets.countries.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className={s.field}>
              <label htmlFor="state">State / province</label>
              <select id="state" name="state" defaultValue={sp.state ?? ""}>
                <option value="">All</option>
                {facets.states.map((st) => <option key={st} value={st}>{st}</option>)}
              </select>
            </div>
            <div className={s.field}>
              <label htmlFor="year">Year joined</label>
              <select id="year" name="year" defaultValue={sp.year ?? ""}>
                <option value="">Any year</option>
                {facets.years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
              </select>
            </div>
            <button type="submit" className={s.apply}>Filter</button>
            {filtered && <a href="/cornerstone-partners" className={s.clear}>Clear</a>}
          </form>
        )}

        {/* The globe — visual centerpiece. The flat list below is always present as
            the fallback (devices/connections where a 3D globe doesn't render). */}
        <PartnerGlobe points={points} />

        {all.length === 0 ? (
          <p className={s.empty}>Our Cornerstone Partners will appear here soon.</p>
        ) : shown.length === 0 ? (
          <p className={s.empty}>No Cornerstone Partners match these filters.</p>
        ) : (
          <>
            <div className={s.count}>{shown.length} {shown.length === 1 ? "partner" : "partners"}</div>
            <div className={s.grid}>
              {shown.map((p) => {
                const loc = [p.city, p.stateProvince].filter(Boolean).join(", ");
                return (
                  <div key={p.partnerNumber} className={s.card}>
                    {p.logoUrl && (
                      <div className={s.logoWrap}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.logoUrl} alt={`${p.churchName} logo`} className={s.logo} />
                      </div>
                    )}
                    <div className={s.name}>
                      {p.website
                        ? <a href={p.website} target="_blank" rel="noopener noreferrer">{p.churchName}</a>
                        : p.churchName}
                    </div>
                    {(loc || p.country) && (
                      <div className={s.meta}>
                        {loc && <>{loc}<br /></>}
                        {p.country}
                      </div>
                    )}
                    <div className={s.badge}>
                      <span className={s.num}>Cornerstone Partner #{p.partnerNumber}</span>
                      <span className={s.year}>· Joined {p.yearJoined}</span>
                    </div>
                    {p.website && <a href={p.website} target="_blank" rel="noopener noreferrer" className={s.site}>Visit website ↗</a>}
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div className={s.cta}>
          <div className={s.ctaTitle}>Is your church a founding supporter?</div>
          <div className={s.ctaSub}>Churches that join during the founding stage are permanently recognized as Cornerstone Partners.</div>
          <a href="/cornerstone" className={s.ctaBtn}>Become a Cornerstone Partner</a>
        </div>
      </div>
    </main>
  );
}
