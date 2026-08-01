import { ImageResponse } from "next/og";
import { PDFDocument } from "pdf-lib";
import { CORNERSTONE_ENABLED } from "@/lib/flags";
import { verifyPartnerAccessToken, getPartnerStatusView, getConfig } from "@/lib/cornerstone";
import { loadBrandFonts, ogFonts, CertificateDoc } from "@/lib/cornerstoneBrand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const W = 1600, H = 1236; // landscape US-Letter aspect (11 x 8.5)

/**
 * Cornerstone Partner certificate — generated ON REQUEST (no stored files). Token
 * gated (?p=<partnerUUID>&t=<hmac>), so no private data is in the URL. Because it
 * reads the live church name but the immutable number + recognition date from the
 * partner record, it automatically "regenerates" correct after a name change
 * while the number/date never move. Rendered via next/og (real Poppins + verbatim
 * locked brand mark), then wrapped into a PDF with pdf-lib.
 */
export async function GET(req: Request) {
  if (!CORNERSTONE_ENABLED) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  const p = url.searchParams.get("p") || "";
  const t = url.searchParams.get("t") || "";
  if (!p || !t || !verifyPartnerAccessToken(p, t)) return new Response("Not found", { status: 404 });

  const view = await getPartnerStatusView(p);
  if (!view) return new Response("Not found", { status: 404 });
  let scripture: string | null = null;
  try { scripture = (await getConfig()).certificate_scripture; } catch { /* optional */ }

  const fonts = await loadBrandFonts();
  const dateIso = view.activationDate ?? view.recognitionDate;

  const img = new ImageResponse(
    <CertificateDoc churchName={view.churchName} displayNumber={view.displayNumber} dateIso={dateIso} scripture={scripture} />,
    { width: W, height: H, fonts: ogFonts(fonts) },
  );

  const png = new Uint8Array(await img.arrayBuffer());

  // Wrap the rendered PNG into a single-page landscape-letter PDF.
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([792, 612]);
  const embedded = await pdf.embedPng(png);
  page.drawImage(embedded, { x: 0, y: 0, width: 792, height: 612 });
  const bytes = await pdf.save();
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

  return new Response(body, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="cornerstone-partner-${view.partnerNumber}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
