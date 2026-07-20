import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  title: "It's God, Yo! — God's Word in your words.",
  description:
    "A daily verse, texted in language that actually sounds like you. Scripture rendered as short, casual messages — in English and Spanish.",
  openGraph: {
    title: "It's God, Yo!",
    description: "God's Word in your words. A daily verse, texted the way you'd actually text.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={poppins.variable}>
      <body>{children}</body>
    </html>
  );
}
