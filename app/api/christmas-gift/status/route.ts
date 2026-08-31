import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadChristmasConfig, resolveWindow } from "@/lib/christmasGift";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public read for the checkout UI: is the campaign open right now, and if so which
 * window / price / bonus applies. Uses the SAME resolveWindow as checkout so the
 * displayed offer can never disagree with what the POST will actually charge. When
 * the campaign is not open, returns { open: false } with the fail-closed reason so
 * the page shows an accurate "not available" state rather than a stale offer.
 */
export async function GET() {
  const admin = getSupabaseAdmin();
  const cfg = await loadChristmasConfig(admin);
  const win = resolveWindow(cfg, Date.now());
  if (!win.ok) {
    return NextResponse.json({ open: false, reason: win.reason });
  }
  return NextResponse.json({
    open: true,
    window: win.window,
    list_price_cents: win.listCents,
    charged_amount_cents: win.chargedCents,
    dmfh_bonus: win.dmfhBonus,
    max_release_at: cfg!.max_release_at,
  });
}
