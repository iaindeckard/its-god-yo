import { ImageResponse } from "next/og";
import { CORNERSTONE_ENABLED } from "@/lib/flags";
import { verifyPartnerAccessToken, getPartnerStatusView } from "@/lib/cornerstone";
import { loadBrandFonts, ogFonts, badgeSvg, BadgeDoc } from "@/lib/cornerstoneBrand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cornerstone Partner badge. Token gated (?p=<partnerUUID>&t=<hmac>) — no private
 * data in the URL. ?format=png (default, transparent background) or ?format=svg.
 * PNG is rendered through the same next/og pipeline (real Poppins + verbatim
 * locked brand mark); SVG is the hand-authored vector emblem.
 */
export async function GET(req: Request) {
  if (!CORNERSTONE_ENABLED) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  const p = url.searchParams.get("p") || "";
  const t = url.searchParams.get("t") || "";
  const format = url.searchParams.get("format") === "svg" ? "svg" : "png";
  if (!p || !t || !verifyPartnerAccessToken(p, t)) return new Response("Not found", { status: 404 });

  const view = await getPartnerStatusView(p);
  if (!view) return new Response("Not found", { status: 404 });

  if (format === "svg") {
    return new Response(badgeSvg(view.partnerNumber), {
      headers: {
        "content-type": "image/svg+xml",
        "content-disposition": `attachment; filename="cornerstone-partner-${view.partnerNumber}-badge.svg"`,
        "cache-control": "private, no-store",
      },
    });
  }

  const fonts = await loadBrandFonts();
  const img = new ImageResponse(
    <BadgeDoc partnerNumber={view.partnerNumber} />,
    { width: 400, height: 400, fonts: ogFonts(fonts) },
  );

  return new Response(await img.arrayBuffer(), {
    headers: {
      "content-type": "image/png",
      "content-disposition": `attachment; filename="cornerstone-partner-${view.partnerNumber}-badge.png"`,
      "cache-control": "private, no-store",
    },
  });
}
