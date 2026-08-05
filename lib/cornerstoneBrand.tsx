import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Shared brand rendering for the Cornerstone certificate + badge. Reuses the
 * EXACT locked assets already used by app/opengraph-image.tsx — the verbatim
 * BubbleMark SVG geometry and the exact brass wordmark treatment — plus the site
 * Poppins woff files, rendered through the same next/og (Satori) pipeline. No
 * re-interpreted logo, no new font, no new render engine.
 */

export const NAVY = "#0B1830";
export const GOLD = "#FFDC52";
export const TEAL = "#00ABBC";
export const BRASS_SHADOW = "2px 2px 0 #D4B14E, 4px 4px 0 #C49F3C, 6px 6px 0 #B08D2E";

// Verbatim locked BubbleMark geometry (variant "primary"), identical to the OG image.
export const BUBBLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72"><path d="M14 10 H58 A8 8 0 0 1 66 18 V48 A8 8 0 0 1 58 56 H28 L14 66 V56 A8 8 0 0 1 6 48 V18 A8 8 0 0 1 14 10 Z" fill="#378ADD"/><ellipse cx="36" cy="16" rx="10" ry="3.5" fill="none" stroke="#FFFFFF" stroke-width="2.4" opacity="0.95"/><rect x="32.85" y="23" width="6.3" height="20" rx="3.15" fill="#FFFFFF" transform="rotate(-8 36 33)"/><circle cx="37.5" cy="48" r="3.78" fill="#FFFFFF"/></svg>`;

export function bubbleDataUri(): string {
  return `data:image/svg+xml;base64,${Buffer.from(BUBBLE_SVG).toString("base64")}`;
}

export async function loadBrandFonts(): Promise<{ poppins400: Buffer; poppins700: Buffer }> {
  const [poppins400, poppins700] = await Promise.all([
    readFile(join(process.cwd(), "app/_fonts/poppins-400.woff")),
    readFile(join(process.cwd(), "app/_fonts/poppins-700.woff")),
  ]);
  return { poppins400, poppins700 };
}

export function ogFonts(f: { poppins400: Buffer; poppins700: Buffer }) {
  return [
    { name: "Poppins", data: f.poppins400, weight: 400 as const, style: "normal" as const },
    { name: "Poppins", data: f.poppins700, weight: 700 as const, style: "normal" as const },
  ];
}

/** The recognition sentence — same tone as the approved email + status page. */
export function recognitionStatement(churchName: string): string {
  return `${churchName} joined during the founding stage of It's God, Yo! and is permanently recognized as a Cornerstone Partner™.`;
}

/** The locked "It's God, Yo!™" wordmark treatment (brass "God,"), as JSX for Satori. */
export function BrandWordmark({ fontSize = 64 }: { fontSize?: number }) {
  const letter = { color: NAVY, fontSize, letterSpacing: -1, lineHeight: 1 } as const;
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: Math.round(fontSize * 0.12) }}>
      <span style={{ ...letter, fontWeight: 400 }}>It&rsquo;s</span>
      <span style={{ ...letter, fontWeight: 700, textShadow: BRASS_SHADOW }}>God,</span>
      <div style={{ display: "flex", alignItems: "flex-start" }}>
        <span style={{ ...letter, fontWeight: 400 }}>Yo</span>
        <span style={{ color: NAVY, fontWeight: 400, fontSize: Math.round(fontSize * 0.44), lineHeight: 1, marginTop: 4 }}>&trade;</span>
      </div>
    </div>
  );
}

/** Certificate document (JSX for next/og). Shared by the route + verification. */
export function CertificateDoc({
  churchName, displayNumber, dateIso, scripture,
}: {
  churchName: string; displayNumber: string; dateIso: string; scripture: string | null;
}) {
  const longDate = new Date(dateIso + "T00:00:00Z").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", background: "#ffffff", padding: 28, fontFamily: "Poppins" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between", border: `6px solid ${GOLD}`, borderRadius: 18, padding: "56px 72px" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={bubbleDataUri()} width={72} height={72} alt="" />
            <BrandWordmark fontSize={58} />
          </div>
          <div style={{ display: "flex", color: TEAL, fontSize: 26, fontWeight: 700, letterSpacing: 6 }}>CORNERSTONE PARTNER</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, textAlign: "center" }}>
          <div style={{ display: "flex", color: "#5b6472", fontSize: 22 }}>This certifies that</div>
          <div style={{ display: "flex", color: NAVY, fontSize: 64, fontWeight: 700, textAlign: "center", maxWidth: 1100 }}>{churchName}</div>
          <div style={{ display: "flex", color: NAVY, fontSize: 34, fontWeight: 700 }}>{displayNumber}</div>
          <div style={{ display: "flex", color: "#3c4552", fontSize: 26, lineHeight: 1.5, textAlign: "center", maxWidth: 1040 }}>{recognitionStatement(churchName)}</div>
          {scripture ? <div style={{ display: "flex", color: TEAL, fontSize: 22, fontStyle: "italic", marginTop: 4 }}>{scripture}</div> : null}
        </div>
        <div style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", color: "#5b6472", fontSize: 20 }}>
            <div style={{ display: "flex" }}>Recognized</div>
            <div style={{ display: "flex", color: NAVY, fontSize: 24, fontWeight: 700 }}>{longDate}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ display: "flex", width: 320, borderTop: "2px solid #1a1f2b", marginBottom: 8 }} />
            <div style={{ display: "flex", color: NAVY, fontSize: 22, fontWeight: 700 }}>Iain Deckard</div>
            <div style={{ display: "flex", color: "#5b6472", fontSize: 18 }}>Founder</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", color: "#5b6472", fontSize: 20 }}>
            <div style={{ display: "flex" }}>itsgodyo.com</div>
            <div style={{ display: "flex", fontSize: 15 }}>Deckard Enterprise International, LLC</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Badge document (JSX for next/og). Transparent surround; navy emblem card. */
export function BadgeDoc({ partnerNumber }: { partnerNumber: number | null }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Poppins" }}>
      <div style={{ width: 320, height: 320, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, background: NAVY, border: `6px solid ${GOLD}`, borderRadius: 40 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={bubbleDataUri()} width={84} height={84} alt="" />
        <div style={{ display: "flex", color: "#ffffff", fontSize: 16, fontWeight: 400, marginTop: 6 }}>It&rsquo;s God, Yo!&trade;</div>
        <div style={{ display: "flex", color: GOLD, fontSize: 27, fontWeight: 700, letterSpacing: 2 }}>CORNERSTONE</div>
        <div style={{ display: "flex", color: "#ffffff", fontSize: 19, fontWeight: 700, letterSpacing: 5 }}>PARTNER</div>
        {partnerNumber != null ? <div style={{ display: "flex", color: GOLD, fontSize: 24, fontWeight: 700, marginTop: 4 }}>#{partnerNumber}</div> : null}
      </div>
    </div>
  );
}

/**
 * Hand-authored badge SVG — a navy emblem on a TRANSPARENT surround (so it drops
 * onto any church site). The brand MARK (bubble) is the verbatim locked geometry;
 * the accompanying text uses the brand font with a graceful system fallback so
 * the file stays small and always valid. No private data anywhere.
 */
export function badgeSvg(partnerNumber: number | null): string {
  const numberLine = partnerNumber != null
    ? `<text x="200" y="322" text-anchor="middle" font-family="Poppins, Helvetica, Arial, sans-serif" font-size="24" font-weight="700" fill="${GOLD}">#${partnerNumber}</text>`
    : "";
  // bubble mark scaled + centered near the top of the emblem
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400" role="img" aria-label="It's God, Yo! Cornerstone Partner${partnerNumber != null ? ` #${partnerNumber}` : ""}">
  <rect x="40" y="40" width="320" height="320" rx="40" fill="${NAVY}"/>
  <rect x="40" y="40" width="320" height="320" rx="40" fill="none" stroke="${GOLD}" stroke-width="6"/>
  <g transform="translate(164 84) scale(1.0)">${BUBBLE_SVG.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "")}</g>
  <text x="200" y="230" text-anchor="middle" font-family="Poppins, Helvetica, Arial, sans-serif" font-size="15" font-weight="400" fill="#ffffff">It&#39;s God, Yo!&#8482;</text>
  <text x="200" y="272" text-anchor="middle" font-family="Poppins, Helvetica, Arial, sans-serif" font-size="26" font-weight="700" letter-spacing="1.5" fill="${GOLD}">CORNERSTONE</text>
  <text x="200" y="300" text-anchor="middle" font-family="Poppins, Helvetica, Arial, sans-serif" font-size="18" font-weight="700" letter-spacing="4" fill="#ffffff">PARTNER</text>
  ${numberLine}
</svg>`;
}
