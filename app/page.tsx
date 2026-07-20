import Link from "next/link";
import BubbleMark from "@/components/BubbleMark";
import Wordmark from "@/components/Wordmark";
import { t, type Lang } from "@/lib/i18n";
import { PLANS, GROUP_BANDS } from "@/lib/plans";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const sp = await searchParams;
  const lang: Lang = sp.lang === "es" ? "es" : "en";
  const s = t[lang];
  const money = (n: number) => `$${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`;
  const signupHref = `/signup${lang === "es" ? "?lang=es" : ""}`;
  const other = lang === "es" ? "en" : "es";

  return (
    <>
      {/* ---------------- Hero ---------------- */}
      <header className="hero">
        <div className="container">
          <nav className="nav">
            <div className="nav-brand">
              <BubbleMark variant="light" size={40} />
              <Wordmark tone="brass" />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <Link href={`/?lang=${other}`} style={{ color: "#bcd3ef", fontWeight: 600 }}>
                {other === "es" ? "Español" : "English"}
              </Link>
              <Link className="btn btn-light" href={signupHref}>
                {s.getStarted}
              </Link>
            </div>
          </nav>

          <div className="hero-grid">
            <div>
              <p className="eyebrow" style={{ color: "#8fb4e6" }}>
                {s.tagline}
              </p>
              <h1>{s.heroTitle}</h1>
              <p className="tagline">{s.heroBody}</p>
              <div className="hero-cta">
                <Link className="btn btn-primary" href={signupHref}>
                  {s.getStarted}
                </Link>
                <a className="btn btn-ghost" href="#pricing" style={{ color: "#eaf1fb", borderColor: "#3a5a86" }}>
                  {s.seePricing}
                </a>
              </div>
              <p className="hero-note">{s.heroNote}</p>
            </div>

            <div className="phone" aria-hidden="true">
              <div className="chat-meta">{s.sampleMeta}</div>
              <div className="chat-bubble">{s.sampleBubble}</div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <BubbleMark variant="primary" size={44} />
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ---------------- How it works ---------------- */}
      <section className="section">
        <div className="container">
          <p className="eyebrow center">{s.howEyebrow}</p>
          <h2 className="center" style={{ marginBottom: 40 }}>
            {s.howTitle}
          </h2>
          <div className="grid cols-3">
            {[
              [s.how1Title, s.how1Body],
              [s.how2Title, s.how2Body],
              [s.how3Title, s.how3Body],
            ].map(([title, body], i) => (
              <div className="card" key={i}>
                <div
                  style={{
                    width: 40, height: 40, borderRadius: 12, background: "var(--igy-blue-tint)",
                    color: "var(--igy-blue)", fontWeight: 800, display: "flex",
                    alignItems: "center", justifyContent: "center", marginBottom: 14,
                  }}
                >
                  {i + 1}
                </div>
                <h3 style={{ fontSize: 19 }}>{title}</h3>
                <p className="muted" style={{ margin: 0 }}>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- Pricing ---------------- */}
      <section className="section" id="pricing" style={{ background: "var(--igy-bg-alt)" }}>
        <div className="container">
          <p className="eyebrow center">{s.pricingEyebrow}</p>
          <h2 className="center">{s.pricingTitle}</h2>
          <p className="center muted" style={{ maxWidth: 640, margin: "0 auto 40px" }}>
            {s.pricingSub}
          </p>

          <div className="grid cols-3">
            {/* Individual */}
            <div className="card featured">
              <span className="badge">{s.mostPopular}</span>
              <div className="plan-name">{s.planIndividualName}</div>
              <p className="plan-desc">{s.planIndividualDesc}</p>
              <div className="price">
                {money(PLANS.individual_monthly.amount!)}
                <small>{s.perMonth}</small>
              </div>
              <p className="muted" style={{ fontSize: 14, margin: "6px 0 0" }}>
                {s.from} {money(PLANS.individual_annual.amount!)}
                {s.perYear}
              </p>
              <Link className="btn btn-primary btn-block" href={signupHref} style={{ marginTop: 18 }}>
                {s.choosePlan}
              </Link>
            </div>

            {/* Family */}
            <div className="card">
              <div className="plan-name">{s.planFamilyName}</div>
              <p className="plan-desc">{s.planFamilyDesc}</p>
              <div className="price">
                {money(PLANS.family_annual.amount!)}
                <small>{s.perYear}</small>
              </div>
              <Link className="btn btn-ghost btn-block" href={signupHref} style={{ marginTop: 18 }}>
                {s.choosePlan}
              </Link>
            </div>

            {/* Gift */}
            <div className="card">
              <div className="plan-name">{s.planGiftName}</div>
              <p className="plan-desc">{s.planGiftDesc}</p>
              <div className="price">
                {money(PLANS.gift_annual.amount!)}
                <small>{s.perYear}</small>
              </div>
              <Link className="btn btn-ghost btn-block" href={signupHref} style={{ marginTop: 18 }}>
                {s.choosePlan}
              </Link>
            </div>
          </div>

          {/* Group */}
          <div className="card" style={{ marginTop: 20 }}>
            <div className="grid cols-2" style={{ alignItems: "center" }}>
              <div>
                <div className="plan-name">{s.planGroupName}</div>
                <p className="plan-desc" style={{ minHeight: 0 }}>{s.planGroupDesc}</p>
                <div className="price">
                  {s.from} {money(GROUP_BANDS[0].amount)}
                  <small>{s.perTeenYear}</small>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <Link className="btn btn-primary" href={signupHref}>
                  {s.choosePlan}
                </Link>
              </div>
            </div>
          </div>

          {/* DM add-on note */}
          <div className="card" style={{ marginTop: 20, borderStyle: "dashed" }}>
            <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
              <BubbleMark variant="primary" size={40} />
              <div>
                <div className="plan-name" style={{ marginBottom: 2 }}>{s.dmAddonName}</div>
                <p className="muted" style={{ margin: 0, fontSize: 15 }}>{s.dmAddonDesc}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- Footer ---------------- */}
      <footer className="footer">
        <div className="container" style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div className="nav-brand">
            <BubbleMark variant="primary" size={32} />
            <Wordmark tone="flat" />
          </div>
          <div>
            {s.footerTagline} · © 2026 · {s.footerRights}
          </div>
        </div>
      </footer>
    </>
  );
}
