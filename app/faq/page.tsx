import type { Metadata } from "next";
import FaqContent from "@/components/FaqContent";

/**
 * DRAFT — pending attorney review. This FAQ contains customer-facing legal /
 * pricing and consent representations. It is intentionally NOT indexed
 * (robots.noindex below) until counsel signs off, matching the draft convention
 * used on /program-terms and the other legal pages (internal marker + noindex,
 * no visible on-page banner). Copy is Iain-approved and locked — do not reword;
 * see components/FaqContent.tsx for the content. Pricing mirrors lib/plans.ts and
 * the DM from Him line is kept consistent with /program-terms §2.2.
 */
export const metadata: Metadata = {
  title: "FAQ — It's God, Yo!™",
  description:
    "Frequently asked questions about It's God, Yo! — the daily verse, plans and pricing, the DM from Him™ add-on, and managing your subscription.",
  robots: { index: false, follow: false }, // pre-launch / pending legal review: not indexed
};

export default function FaqPage() {
  return <FaqContent />;
}
