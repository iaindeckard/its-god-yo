import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-poppins",
  display: "swap",
});

// Site-wide metadata defaults (locked copy, IGY-OG-Tags-LOCKED-2026-07-23.md).
// Individual pages can override title/description by exporting their own
// `metadata`; the OG/Twitter image comes from app/opengraph-image.tsx +
// app/twitter-image.tsx (Next injects those tags for every route).
const OG_TITLE = "It's God, Yo! — Faith that fits in a text";
const OG_DESCRIPTION =
  "A daily verse, texted the way they'd actually read it. Faith-based texting for teens, and a reminder for the families who love them too.";
const SITE_URL = "https://itsgodyo.com"; // canonical custom domain (used for absolute og:url + image URLs)

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL), // makes the og/twitter image URLs absolute
  title: OG_TITLE,
  description: OG_DESCRIPTION,
  openGraph: {
    title: OG_TITLE,
    description: OG_DESCRIPTION,
    siteName: "It's God, Yo!",
    url: SITE_URL,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: OG_TITLE,
    description: OG_DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={poppins.variable}>
      <body>{children}</body>
    </html>
  );
}
