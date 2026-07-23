import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Site-wide Open Graph image (1200x630). Reproduces the locked wordmark — the
// dark message-bubble treatment from the gate/hero ("It's" / "God," in brass /
// "Yo" / the bubble-and-bang icon) centered on the #0B1830 navy, with the
// tagline beneath — using the exact BubbleMark SVG geometry, the exact brass
// text-shadow values, and the site font (Poppins). Rendered via next/og so no
// static asset needs regenerating; Next wires the meta tags automatically (and
// twitter-image re-exports this).

export const runtime = "nodejs";
export const alt = "It's God, Yo! — Faith that fits in a text";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Exact BubbleMark geometry (variant "primary": blue bubble, white mark).
const BUBBLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72"><path d="M14 10 H58 A8 8 0 0 1 66 18 V48 A8 8 0 0 1 58 56 H28 L14 66 V56 A8 8 0 0 1 6 48 V18 A8 8 0 0 1 14 10 Z" fill="#378ADD"/><path d="M24 17 Q35 7 46 17" stroke="#FFFFFF" stroke-width="3.4" fill="none" stroke-linecap="round" opacity="0.95"/><rect x="30" y="20" width="10" height="24" rx="5" fill="#FFFFFF" transform="rotate(-8 35 32)"/><circle cx="36" cy="50" r="5.5" fill="#FFFFFF"/></svg>`;

export default async function Image() {
  // Read at prerender/build time (this image is static) from the colocated fonts.
  const [poppins400, poppins700] = await Promise.all([
    readFile(join(process.cwd(), "app/_fonts/poppins-400.woff")),
    readFile(join(process.cwd(), "app/_fonts/poppins-700.woff")),
  ]);
  const bubble = `data:image/svg+xml;base64,${Buffer.from(BUBBLE_SVG).toString("base64")}`;

  const letter = { color: "#ffffff", fontSize: 104, letterSpacing: -2, lineHeight: 1 } as const;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", background: "#0B1830", fontFamily: "Poppins",
        }}
      >
        {/* dark message-bubble treatment (tail bottom-left), holding the wordmark */}
        <div
          style={{
            display: "flex", alignItems: "center", gap: 14,
            background: "#111b30", border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: "36px 36px 36px 10px", padding: "40px 62px",
          }}
        >
          <span style={{ ...letter, fontWeight: 400 }}>It&rsquo;s</span>
          <span style={{ ...letter, fontWeight: 700, textShadow: "2px 2px 0 #D4B14E, 4px 4px 0 #C49F3C, 6px 6px 0 #B08D2E" }}>God,</span>
          <span style={{ ...letter, fontWeight: 400 }}>Yo</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={bubble} width={112} height={112} alt="" style={{ marginLeft: 4 }} />
        </div>
        <div style={{ display: "flex", color: "#a9bad6", fontSize: 40, fontWeight: 500, marginTop: 46 }}>
          Faith that fits in a text
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Poppins", data: poppins400, weight: 400, style: "normal" },
        { name: "Poppins", data: poppins700, weight: 700, style: "normal" },
      ],
    },
  );
}
