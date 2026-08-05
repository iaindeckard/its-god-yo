import "server-only";
import { getStripe } from "./stripe";
import { getSupabaseAdmin } from "./supabaseAdmin";
import { DM_ADDON, baseIntervalForPlanKey, dmPriceForBaseInterval } from "./plans";

/**
 * DM from Him add-on (single-subscriber, redefined 2026-08-01).
 *
 * It is NOT a second recipient and NOT separately-curated content: it reuses the
 * SAME daily verse already selected for that subscriber and re-wraps it in a
 * personal, first-person note — the feel of a text straight from Him rather than
 * a citation. Content is a framing of the same verse (composeDailyMessage below),
 * so no new selection, no new content table.
 *
 * Lifecycle is SMS-keyword driven (no web portal, no customer login): STOP cancels
 * the whole subscription (base + add-on) via lib/cancelSubscription; "DM ON"/"DM
 * OFF" toggles just the add-on here without touching the base. The add-on rides
 * the base subscription's single trial clock (added as a line item at creation, or
 * mid-subscription here) — there is no separate add-on trial.
 */

// All DM prices (old $1.99 + new $2.99 monthly, and the annual variant) carry one
// of these Stripe nicknames, so we match the add-on line item by nickname
// regardless of price version, mode, or interval.
const DM_NICKNAMES = ["dm_addon_monthly", "dm_addon_annual"];

/**
 * Compose the daily SMS body. Base = the verse text exactly as selected. When the
 * recipient has DM from Him on, the SAME text is wrapped in first-person framing.
 * (Deterministic template for now; a richer generated framing could replace the
 * wrap later without changing the send pipeline.)
 */
export function composeDailyMessage(
  verseText: string,
  opts: { dm: boolean; firstName?: string | null; lang: "en" | "es"; opener?: string | null },
): string {
  if (!opts.dm) return verseText;
  const name = opts.firstName?.trim();
  // English DM with an inspirational opener that fit the 2-segment budget: the
  // opener REPLACES the standard greeting line (it IS the personalized lead-in).
  // `opener` is already [name]-substituted (lib/dmOpeners.renderOpener) and only
  // passed by lib/dailySend after the fit-guard clears it; everything else falls
  // through to the standard wrap.
  if (opts.opener && opts.lang === "en") {
    return `${opts.opener}\n\n${verseText}\n\nI've got you.`;
  }
  // GSM-7-safe wrap (no emoji, straight apostrophe) so the DM-wrapped message can
  // stay within the 2-segment budget — see docs/VERSE-LENGTH-AND-FIDELITY-SPEC.md
  // (§1.3/§1.4). The generation-side segment check (generate-daily-verse /
  // generate-monthly-batch) replicates THIS exact wrap — keep them in sync.
  if (opts.lang === "es") {
    return `${name ? name + ", " : ""}algo de Mi parte hoy.\n\n${verseText}\n\nEstoy contigo.`;
  }
  return `${name ? name + ", " : ""}a little note from Me today.\n\n${verseText}\n\nI've got you.`;
}

interface DmSignup {
  id: string;
  dm_addon: boolean | null;
  plan_key: string | null;
  group_teen_count: number | null;
  stripe_subscription_id: string | null;
}

/**
 * How many teens the DM add-on bills for (Option B, per-teen quantity):
 *  - Group (church/org): the plan's group_teen_count — same per-teen scaling as
 *    family (a 200-teen group pays for 200). group_teen_count is set at signup and
 *    doesn't change post-signup today (no group-management flow), so this reflects
 *    the current value whenever DM is reconciled.
 *  - Family: confirmed family teens whose own 7-day trial has elapsed — the SAME
 *    billable set the extra-teen line uses, so DM stays free during each teen's
 *    trial and starts billing at that teen's trial-end.
 *  - Individual / gift: 1.
 */
async function dmBillableQuantity(ps: DmSignup): Promise<number> {
  if (typeof ps.plan_key === "string" && ps.plan_key.startsWith("group_")) {
    return Math.max(1, ps.group_teen_count ?? 1);
  }
  if (ps.plan_key !== "family") return 1;
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("consent_log")
    .select("trial_ends_at")
    .eq("pending_signup_id", ps.id)
    .eq("consent_type", "family_teen")
    .eq("consent_status", "confirmed");
  const now = Date.now();
  return (data ?? []).filter((t) => t.trial_ends_at && new Date(t.trial_ends_at as string).getTime() <= now).length;
}

export interface DmToggleResult {
  ok: boolean;
  state: "on" | "off";
  quantity: number;
  changed: boolean;
  detail?: string;
}

/**
 * Reconcile the DM add-on line item to the desired state:
 *   target quantity = dm_addon ? (family: billable teens; else 1) : 0
 * using the price whose interval MATCHES the base plan (never mismatched). This is
 * the single source of truth, called by DM ON/OFF and by the family teen add/remove
 * flow so the quantity auto-tracks the teen count.
 *
 * Proration is direction-aware (Iain: no refunds):
 *   - increase / first attach → `always_invoice` (charge the prorated amount now);
 *   - decrease / removal     → `none` (NO credit for unused paid time).
 * Timing matches STOP (immediate): the framing stops on the next send as soon as
 * the dm_addon flag flips, and item changes apply immediately with no credit.
 * Idempotent; no-op when there's no live subscription yet (the item is attached at
 * subscription creation instead).
 */
export async function reconcileDmAddon(pendingSignupId: string): Promise<DmToggleResult> {
  const admin = getSupabaseAdmin();
  const { data: ps } = await admin
    .from("pending_signups")
    .select("id, dm_addon, plan_key, group_teen_count, stripe_subscription_id")
    .eq("id", pendingSignupId)
    .maybeSingle();
  if (!ps) return { ok: false, state: "off", quantity: 0, changed: false, detail: "signup_not_found" };

  const on = !!ps.dm_addon;
  const subId = (ps.stripe_subscription_id as string | null) ?? null;
  if (!subId) return { ok: true, state: on ? "on" : "off", quantity: 0, changed: false, detail: "no_subscription_yet" };

  const stripe = getStripe();
  const sub = await stripe.subscriptions.retrieve(subId);
  if (sub.status === "canceled" || sub.status === "incomplete_expired") {
    return { ok: true, state: on ? "on" : "off", quantity: 0, changed: false, detail: "subscription_inactive" };
  }

  const target = on ? await dmBillableQuantity(ps as DmSignup) : 0;
  const dmItem = sub.items.data.find((it) => it.price?.nickname != null && DM_NICKNAMES.includes(it.price.nickname));
  const current = dmItem?.quantity ?? 0;
  if (target === current) return { ok: true, state: on ? "on" : "off", quantity: current, changed: false };

  const dmPrice = dmPriceForBaseInterval(baseIntervalForPlanKey(ps.plan_key));

  if (target > current) {
    // Increase / first attach → charge the prorated amount today.
    if (!dmItem) {
      await stripe.subscriptionItems.create({ subscription: subId, price: dmPrice, quantity: target, proration_behavior: "always_invoice" });
    } else {
      await stripe.subscriptionItems.update(dmItem.id, { quantity: target, proration_behavior: "always_invoice" });
    }
  } else {
    // Decrease / removal → NO credit for the remainder already paid.
    if (target === 0) {
      if (dmItem) await stripe.subscriptionItems.del(dmItem.id, { proration_behavior: "none" });
    } else {
      await stripe.subscriptionItems.update(dmItem!.id, { quantity: target, proration_behavior: "none" });
    }
  }
  return { ok: true, state: on ? "on" : "off", quantity: target, changed: true };
}

/**
 * Turn the add-on on/off for a subscriber (SMS DM ON / DM OFF). Flips the
 * pending_signups.dm_addon flag (source of truth for the daily audience + creation
 * time) then reconciles the line item. Never touches the base item — STOP handles
 * full cancellation. Idempotent; safe before a subscription exists.
 */
export async function setDmAddon(pendingSignupId: string, on: boolean): Promise<DmToggleResult> {
  const admin = getSupabaseAdmin();
  const { data: ps } = await admin.from("pending_signups").select("id, dm_addon_price_id").eq("id", pendingSignupId).maybeSingle();
  if (!ps) return { ok: false, state: on ? "on" : "off", quantity: 0, changed: false, detail: "signup_not_found" };
  await admin
    .from("pending_signups")
    .update({ dm_addon: on, dm_addon_price_id: on ? DM_ADDON.monthly_price_id : ps.dm_addon_price_id })
    .eq("id", pendingSignupId);
  return reconcileDmAddon(pendingSignupId);
}
