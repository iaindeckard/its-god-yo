import type { PartnerStatusView } from "@/lib/cornerstone";
import type { EnrollmentLink, EnrollmentProgress } from "@/lib/churchEnrollment";
import type { RosterStatus } from "@/lib/churchRoster";
import CopyField from "./CopyField";
import RosterTracker from "./RosterTracker";

/**
 * The church-facing Cornerstone Partner section. Presentational only (no client
 * JS). Certificate (PDF) + badge (PNG/SVG) download to token-gated generation
 * endpoints — no private data in the URLs.
 */

const NAVY = "#0B1830";
const GOLD = "#FFDC52";
const TEAL = "#00ABBC";
const SUPPORT_EMAIL = "hello@itsgodyo.com";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "12px 0", borderTop: "1px solid #eef0f4" }}>
      <span style={{ color: "#5b6472", fontSize: 14 }}>{label}</span>
      <span style={{ color: "#1a1f2b", fontSize: 14, fontWeight: 600, textAlign: "right" }}>{children}</span>
    </div>
  );
}

function Badge() {
  // Inline recognition emblem — a display mark, NOT the downloadable badge asset.
  return (
    <div aria-hidden="true" style={{
      width: 72, height: 72, borderRadius: "50%", background: NAVY,
      display: "flex", alignItems: "center", justifyContent: "center",
      boxShadow: `0 0 0 4px ${GOLD}`, margin: "0 auto 14px",
    }}>
      <svg width="34" height="34" viewBox="0 0 24 24" fill={GOLD} aria-hidden="true">
        <path d="M12 2l2.6 6.3L21 9l-4.8 4.3L17.5 20 12 16.5 6.5 20l1.3-6.7L3 9l6.4-.7z" />
      </svg>
    </div>
  );
}

function EnrollmentStat({ n, label, emphasis }: { n: number; label: string; emphasis?: boolean }) {
  return (
    <div style={{ flex: "1 1 96px", textAlign: "center", padding: "12px 8px", borderRadius: 10, background: emphasis ? "#0B1830" : "#f7f9fb", border: emphasis ? "none" : "1px solid #eef0f4" }}>
      <div style={{ fontSize: 24, fontWeight: 700, color: emphasis ? GOLD : "#111826" }}>{n}</div>
      <div style={{ fontSize: 12, color: emphasis ? "#c9d3e4" : "#5b6472", marginTop: 2 }}>{label}</div>
    </div>
  );
}

function GroupEnrollment({ link, progress }: { link: EnrollmentLink; progress: EnrollmentProgress }) {
  const paused = link.status !== "active";
  return (
    <div style={{ marginTop: 26, paddingTop: 20, borderTop: "1px solid #eef0f4" }}>
      <div style={{ fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase", color: TEAL, fontWeight: 700, marginBottom: 4 }}>
        Invite your group
      </div>
      <h2 style={{ fontSize: 18, margin: "0 0 6px", color: "#111826" }}>Your enrollment link</h2>
      <p style={{ color: "#4a5462", fontSize: 14, lineHeight: 1.55, margin: "0 0 8px" }}>
        Share this with your youth. Announce it, text it, or print the code in your bulletin.
        Each teen signs up on their own and confirms by text; you never handle anyone&rsquo;s phone
        number, and every teen who joins through your link is credited to your church.
      </p>

      {paused ? (
        <p style={{ color: "#9a6b00", background: "#fff7e0", borderRadius: 8, padding: "10px 12px", fontSize: 13 }}>
          Your enrollment link is currently paused. Contact support to turn it back on.
        </p>
      ) : (
        <>
          <CopyField label="Share link" value={link.url} />
          <CopyField label="Or share this code" value={link.displayCode} />

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 18 }}>
            <EnrollmentStat n={progress.joined} label="Joined" emphasis />
            <EnrollmentStat n={progress.active} label="Active" />
            <EnrollmentStat n={progress.awaitingConfirmation} label="Invited, not yet confirmed" />
            <EnrollmentStat n={progress.totalStarted} label="Total started" />
          </div>
          <p style={{ color: "#9aa2ad", fontSize: 12, marginTop: 8 }}>
            &ldquo;Joined&rdquo; means a teen confirmed by text and their subscription started.
            {progress.lastSignupAt ? ` Most recent: ${new Date(progress.lastSignupAt).toLocaleDateString()}.` : " No signups through your link yet."}
          </p>
        </>
      )}
    </div>
  );
}

export default function CornerstoneSection({
  view, enrollment, auth, certificateUrl, badgePngUrl, badgeSvgUrl,
}: {
  view: PartnerStatusView;
  enrollment: { link: EnrollmentLink; progress: EnrollmentProgress; roster: RosterStatus } | null;
  auth: { p: string; t: string };
  certificateUrl: string;
  badgePngUrl: string;
  badgeSvgUrl: string;
}) {
  const {
    displayNumber, churchName, cornerstoneStatus, recognitionDate, activationDate,
    planLabel, includedParticipants, lockedPricingStatus, lockedPriceLabel, publicListingStatus,
  } = view;

  const lockedLine =
    lockedPricingStatus === "active"
      ? "Your qualifying annual church rate is locked under the Cornerstone Partner terms."
      : lockedPricingStatus === "suspended"
        ? "Your Cornerstone locked pricing is currently suspended. Your church remains a Cornerstone Partner."
        : "Your church remains a Cornerstone Partner, but the original locked-pricing benefit is no longer active.";

  const dlBtn: React.CSSProperties = {
    display: "inline-block", padding: "10px 16px", borderRadius: 8, border: `1px solid ${TEAL}`,
    background: TEAL, color: "#fff", fontWeight: 600, fontSize: 14, textDecoration: "none",
  };
  const dlGhost: React.CSSProperties = {
    display: "inline-block", padding: "10px 16px", borderRadius: 8, border: "1px solid #d7dbe2",
    background: "#fff", color: "#1a1f2b", fontWeight: 600, fontSize: 14, textDecoration: "none",
  };
  const linkStyle: React.CSSProperties = { color: TEAL, textDecoration: "none", fontWeight: 600, fontSize: 14 };

  return (
    <main style={{ minHeight: "100vh", background: NAVY, padding: "48px 20px" }}>
      <div style={{ maxWidth: 560, margin: "0 auto", background: "#fff", borderRadius: 16, padding: "32px 28px", fontFamily: "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif" }}>
        <div style={{ textAlign: "center" }}>
          <Badge />
          <div style={{ fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase", color: TEAL, fontWeight: 700 }}>Cornerstone Partner&trade;</div>
          <h1 style={{ fontSize: 26, margin: "6px 0 10px", color: "#111826" }}>{displayNumber}</h1>
          <p style={{ color: "#4a5462", fontSize: 15, lineHeight: 1.55, margin: 0 }}>
            {churchName} joined during the founding stage of It&rsquo;s God, Yo!&trade; and is permanently recognized as a Cornerstone Partner.
          </p>
          {cornerstoneStatus !== "active" && (
            <p style={{ color: "#9a6b00", background: "#fff7e0", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginTop: 14 }}>
              Your Cornerstone recognition is permanent. This designation is currently marked <strong>{cornerstoneStatus}</strong>.
            </p>
          )}
        </div>

        <div style={{ marginTop: 22 }}>
          <Row label="Cornerstone status">{cornerstoneStatus}</Row>
          <Row label="Recognized since">{recognitionDate}</Row>
          {activationDate && <Row label="Activated">{activationDate}</Row>}
          <Row label="Subscription plan">{planLabel ?? "N/A"}</Row>
          <Row label="Included participants">{includedParticipants ?? "N/A"}</Row>
          <Row label="Locked-pricing status">{lockedPricingStatus}</Row>
          {lockedPriceLabel && <Row label="Locked rate">{lockedPriceLabel}</Row>}
          <Row label="Public recognition">{publicListingStatus === "listed" ? "Listed on the public Cornerstone Partners page" : "Not publicly listed"}</Row>
        </div>

        <p style={{ marginTop: 16, color: "#4a5462", fontSize: 14, lineHeight: 1.5, background: "#f7f9fb", borderRadius: 8, padding: "12px 14px" }}>
          {lockedLine}
        </p>

        {/* Certificate + badge downloads — token-gated generation endpoints. */}
        <div style={{ marginTop: 22 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <a href={certificateUrl} style={dlBtn}>Download certificate (PDF)</a>
            <a href={badgePngUrl} style={dlGhost}>Download badge (PNG)</a>
            <a href={badgeSvgUrl} style={dlGhost}>Badge (SVG)</a>
          </div>
          <p style={{ color: "#9aa2ad", fontSize: 12, marginTop: 8 }}>Use your badge on your church website, newsletter, or socials. Your certificate is a print-ready PDF.</p>
        </div>

        {enrollment && <GroupEnrollment link={enrollment.link} progress={enrollment.progress} />}

        {enrollment && <RosterTracker initial={enrollment.roster} auth={auth} />}

        <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid #eef0f4", display: "flex", gap: 18, flexWrap: "wrap" }}>
          <a href="/program-terms#cornerstone-partner-program" style={linkStyle}>Program terms</a>
          <a href={`mailto:${SUPPORT_EMAIL}`} style={linkStyle}>Contact support</a>
        </div>
      </div>
    </main>
  );
}
