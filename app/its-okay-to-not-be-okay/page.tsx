import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "It's okay to not be okay — It's God, Yo!",
  robots: { index: false, follow: false },
};

/**
 * PLACEHOLDER — item 4 is intentionally NOT built. The real copy/resources are
 * to come from USN's equivalent page (usn.network/its-okay-to-not-be-okay) and
 * were NOT invented here. This "coming soon" page exists only so the nav/footer/
 * banner links resolve rather than 404 in the meantime.
 */
export default function ItsOkayComingSoon() {
  return (
    <main style={{ minHeight: "100vh", background: "#0B1830", color: "#fff", fontFamily: "'Poppins',system-ui,sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px" }}>
      <div style={{ maxWidth: 520, textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 16 }} aria-hidden="true">&#10084;</div>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 12 }}>It&rsquo;s okay to not be okay.</h1>
        <p style={{ color: "#a9bad6", lineHeight: 1.65, fontSize: 15 }}>
          Our support and resources page is coming soon. If you or someone you know needs help right now, please reach out to a trusted adult or your local emergency services.
        </p>
        <p style={{ marginTop: 24 }}>
          <a href="/" style={{ color: "#7ea8e0", fontSize: 14 }}>&larr; Back home</a>
        </p>
      </div>
    </main>
  );
}
