import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Christmas Scheduled Gift 2026 — server-side campaign logic (config read, window
 * resolution, price computation). This is the ONE place that decides which pricing
 * window a purchase falls into and what to charge, so checkout never guesses.
 *
 * Fail-closed by construction: every resolver returns a discriminated result and
 * the caller rejects the purchase on any `ok: false`. There is no silent default
 * price and no "assume standard" branch.
 *
 * Everything here is service-role only (the config table has RLS enabled with no
 * policies); callers pass the admin client.
 */

export type PurchaseWindow = "early_bird" | "flash_sale" | "standard";

export interface ChristmasConfig {
  campaign_active: boolean;
  sale_opens_at: string | null;
  early_bird_cutoff_at: string | null;
  flash_sale_starts_at: string | null;
  flash_sale_ends_at: string | null;
  flash_sale_discount_pct: number | string | null;
  campaign_closes_at: string | null;
  max_release_at: string | null;
  list_price_cents: number;
}

const CONFIG_COLUMNS =
  "campaign_active, sale_opens_at, early_bird_cutoff_at, flash_sale_starts_at, flash_sale_ends_at, flash_sale_discount_pct, campaign_closes_at, max_release_at, list_price_cents";

/** Load the single config row. Returns null if the row is missing entirely. */
export async function loadChristmasConfig(admin: SupabaseClient): Promise<ChristmasConfig | null> {
  const { data, error } = await admin
    .from("christmas_gift_2026_config")
    .select(CONFIG_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return (data as ChristmasConfig | null) ?? null;
}

const ms = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

export type WindowResult =
  | { ok: true; window: PurchaseWindow; listCents: number; chargedCents: number; dmfhBonus: boolean }
  | { ok: false; reason: string };

/**
 * Decide the active window + amount to charge for a purchase happening at `nowMs`.
 * FAIL CLOSED: campaign off, config missing a required date, purchase outside the
 * open sale window, or an ambiguous/misconfigured window all return ok:false. The
 * caller must reject the purchase and never fall back to a guessed price.
 */
export function resolveWindow(cfg: ChristmasConfig | null, nowMs: number): WindowResult {
  if (!cfg) return { ok: false, reason: "config_missing" };
  if (!cfg.campaign_active) return { ok: false, reason: "campaign_inactive" };

  const opens = ms(cfg.sale_opens_at);
  const earlyCut = ms(cfg.early_bird_cutoff_at);
  const flashStart = ms(cfg.flash_sale_starts_at);
  const flashEnd = ms(cfg.flash_sale_ends_at);
  const closes = ms(cfg.campaign_closes_at);
  const list = Number(cfg.list_price_cents);
  const pct = Number(cfg.flash_sale_discount_pct);

  // Every gating date and the price must be present + well-formed, or we cannot
  // safely price the purchase.
  if (opens == null || earlyCut == null || flashStart == null || flashEnd == null || closes == null) {
    return { ok: false, reason: "config_dates_incomplete" };
  }
  if (!Number.isFinite(list) || list <= 0) return { ok: false, reason: "config_price_invalid" };
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { ok: false, reason: "config_discount_invalid" };

  // Sanity: the windows must be monotonic (opens <= earlyCut < flashStart <= flashEnd <= closes).
  // A misordered config is ambiguous; refuse rather than mis-price.
  if (!(opens <= earlyCut && earlyCut < flashStart && flashStart <= flashEnd && flashEnd <= closes)) {
    return { ok: false, reason: "config_window_order_invalid" };
  }

  if (nowMs < opens) return { ok: false, reason: "sale_not_open" };
  if (nowMs > closes) return { ok: false, reason: "campaign_closed" };

  if (nowMs <= earlyCut) {
    return { ok: true, window: "early_bird", listCents: list, chargedCents: list, dmfhBonus: true };
  }
  if (nowMs >= flashStart && nowMs <= flashEnd) {
    const charged = Math.round((list * (100 - pct)) / 100);
    return { ok: true, window: "flash_sale", listCents: list, chargedCents: charged, dmfhBonus: true };
  }
  if (nowMs > flashEnd) {
    return { ok: true, window: "standard", listCents: list, chargedCents: list, dmfhBonus: false };
  }
  // Gap between early-bird cutoff and flash-sale start (only reachable if an admin
  // edits the dates to leave a hole). Ambiguous -> refuse.
  return { ok: false, reason: "window_ambiguous" };
}

export type ReleaseResult = { ok: true; releaseDate: string } | { ok: false; reason: string };

/**
 * Validate the buyer-chosen release date (YYYY-MM-DD). Must be a real date, strictly
 * after today (so the confirmation text is genuinely scheduled, not immediate), and
 * on/before the admin-configured latest release date.
 */
export function validateReleaseDate(input: unknown, cfg: ChristmasConfig, nowMs: number): ReleaseResult {
  if (typeof input !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return { ok: false, reason: "release_date_malformed" };
  }
  const rel = Date.parse(`${input}T00:00:00Z`);
  if (Number.isNaN(rel)) return { ok: false, reason: "release_date_invalid" };

  // Compare on calendar date in UTC terms; "today" is derived from nowMs.
  const todayUtc = new Date(nowMs);
  const todayMidnightUtc = Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), todayUtc.getUTCDate());
  if (rel <= todayMidnightUtc) return { ok: false, reason: "release_date_not_future" };

  if (cfg.max_release_at) {
    const max = Date.parse(`${cfg.max_release_at}T00:00:00Z`);
    if (!Number.isNaN(max) && rel > max) return { ok: false, reason: "release_date_after_max" };
  }
  return { ok: true, releaseDate: input };
}
