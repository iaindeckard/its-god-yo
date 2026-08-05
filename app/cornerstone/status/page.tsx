import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CORNERSTONE_ENABLED } from "@/lib/flags";
import { verifyPartnerAccessToken, getPartnerStatusView } from "@/lib/cornerstone";
import CornerstoneSection from "./CornerstoneSection";

export const metadata: Metadata = {
  title: "Your Cornerstone Partner status | It's God, Yo!™",
  robots: { index: false, follow: false }, // private, token-gated — never index
};

export const dynamic = "force-dynamic";

/**
 * Church-facing Cornerstone status page. IGY has no customer login, so access is
 * a signed, non-expiring token over the partner UUID (see lib/cornerstone) —
 * the same "no app, no account" shape as the teen /welcome link. Any failure
 * (flag off, bad/missing token, unknown partner) is an indistinguishable 404 so
 * nothing about a partner is revealed. A church with no approved application has
 * no partner row, so it simply 404s — no empty state, no "apply now" here.
 */
export default async function CornerstoneStatusPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; t?: string }>;
}) {
  if (!CORNERSTONE_ENABLED) notFound();
  const { p, t } = await searchParams;
  if (!p || !t || !verifyPartnerAccessToken(p, t)) notFound();

  const view = await getPartnerStatusView(p);
  if (!view) notFound();

  const q = `p=${encodeURIComponent(p)}&t=${encodeURIComponent(t)}`;
  return (
    <CornerstoneSection
      view={view}
      certificateUrl={`/api/cornerstone/certificate?${q}`}
      badgePngUrl={`/api/cornerstone/badge?${q}&format=png`}
      badgeSvgUrl={`/api/cornerstone/badge?${q}&format=svg`}
    />
  );
}
