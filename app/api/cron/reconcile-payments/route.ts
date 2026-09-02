import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cronAuth";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { upsertSubscriptionPayment, tsIso, type PaymentCapture } from "@/lib/subscriptionPayments";
import { sendSmsAlert, resolveSmsAlert, SMS_ALERT } from "@/lib/smsAlert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Backfill / reconciliation safety net for subscription_payments (Vercel Cron).
 *
 * WHY THIS EXISTS: the webhook capture is best-effort — a failure is swallowed by
 * safeCapture (to protect status/referral logic) and there is NO Stripe retry for
 * a swallowed capture. This job is the durability guarantee behind that design: it
 * periodically lists Stripe balance transactions, compares them against the ledger,
 * and backfills anything missing (idempotent on balance_transaction_id, via the
 * SAME lib/subscriptionPayments upsert the webhook uses — so rows are identical).
 *
 * SCOPE = the webhook's scope, exactly, so a run never reports a false gap:
 *   - charge  : balance-tx whose source is a charge WITH an invoice (webhook only
 *               captures invoice.paid — a non-invoice one-off charge is skipped),
 *               PLUS a non-invoice charge whose PaymentIntent is a christmas_gift_2026
 *               campaign purchase (webhook captures those via payment_intent.succeeded;
 *               matched here against christmas_gift_2026_purchases by PI id).
 *   - refund  : source is a refund (webhook captures all refunds).
 *   - dispute : source is a dispute. The initial withdrawal (negative) is a webhook
 *               responsibility; a dispute_reversal (positive, won-back) is captured
 *               ONLY here — recorded as a signed positive row, but NOT counted as a
 *               gap (the webhook was never responsible for it).
 *
 * ALERTING: a missing row only counts as a GAP (webhook silently failed) if it is
 * webhook-responsible AND older than the 2h grace window (younger ones are almost
 * certainly the webhook still in flight — backfilled silently). On gaps>0 the run
 * logs at error level, records the run, and emails Iain.
 *
 * Every run writes one payment_reconciliation_runs row (including failures) so a
 * broken safety net is itself visible.
 *
 * Auth: a CRON_SECRET bearer (auto-sent by Vercel Cron) for manual/test runs.
 * Query: ?days=N look-back (default 7; monthly deep-reconcile calls ?days=40),
 *        ?dry=1 scans + records the run but inserts no ledger rows / sends no email.
 */

const GRACE_MS = 2 * 60 * 60 * 1000; // 2h

const idOf = (v: unknown): string | null =>
  typeof v === "string" ? v : (v as { id?: string } | null)?.id ?? null;

interface InScope {
  bt: Stripe.BalanceTransaction;
  cap: PaymentCapture;
  webhookResponsible: boolean;
}

export async function GET(req: Request) {
  const authed = isAuthorizedCron(req);
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 7));
  const dryRun = url.searchParams.get("dry") === "1";
  const startedMs = Date.now();
  const rollingStartSec = Math.floor(startedMs / 1000) - days * 86400;
  // Ledger epoch: never reconcile balance transactions created before
  // RECONCILE_MIN_CREATED_SEC (unix seconds). Set this to go-live time so the job
  // permanently ignores pre-launch test-mode charges — keeps the ledger clean and
  // the daily run quiet (no re-backfill, no false gap alerts). Unset/0 = no floor.
  const epochFloorSec = Number(process.env.RECONCILE_MIN_CREATED_SEC) || 0;
  const windowStartSec = Math.max(rollingStartSec, epochFloorSec);
  const windowStartIso = new Date(windowStartSec * 1000).toISOString();

  const stripe = getStripe();
  const admin = getSupabaseAdmin();

  const recordRun = async (row: Record<string, unknown>) => {
    try {
      await admin.from("payment_reconciliation_runs").insert(row);
    } catch (e) {
      console.error("[reconcile-payments] failed to write run-log row:", e);
    }
  };

  try {
    // 1) List in-scope balance transactions in the window (source expanded inline).
    const inScope: InScope[] = [];
    // Non-invoice charges that MIGHT be Christmas gift campaign PIs (captured by the
    // webhook's payment_intent.succeeded). Resolved against our purchases table after
    // the scan so we add only real campaign charges and still skip every other one-off.
    const christmasCandidates: { bt: Stripe.BalanceTransaction; ch: Stripe.Charge; piId: string }[] = [];
    let scanned = 0;
    for await (const bt of stripe.balanceTransactions.list({
      created: { gte: windowStartSec },
      limit: 100,
      expand: ["data.source"],
    })) {
      scanned++;
      const src = bt.source;
      if (!src || typeof src === "string") continue;
      const obj = (src as { object?: string }).object;

      if (obj === "charge") {
        const ch = src as Stripe.Charge;
        const invoiceId = idOf((ch as unknown as { invoice?: unknown }).invoice);
        if (!invoiceId) {
          // Non-invoice charge. In scope ONLY if it is a Christmas gift campaign PI
          // (resolved below); every other one-off charge stays out of scope as before.
          const piId = idOf((ch as unknown as { payment_intent?: unknown }).payment_intent);
          if (piId) christmasCandidates.push({ bt, ch, piId });
          continue;
        }
        inScope.push({
          bt,
          webhookResponsible: true,
          cap: {
            kind: "charge",
            bt,
            livemode: ch.livemode,
            originalAmountCents: ch.amount ?? null,
            originalCurrency: ch.currency ?? null,
            chargeId: ch.id,
            invoiceId,
            paymentIntentId: idOf((ch as unknown as { payment_intent?: unknown }).payment_intent),
            subscriptionId: null, // enriched from the invoice only if we actually backfill (rare)
            customerId: idOf((ch as unknown as { customer?: unknown }).customer),
            billingReason: null,
            status: "paid",
            periodStart: null,
            periodEnd: null,
          },
        });
      } else if (obj === "refund") {
        const rf = src as Stripe.Refund;
        inScope.push({
          bt,
          webhookResponsible: true,
          cap: {
            kind: "refund",
            bt,
            livemode: (rf as unknown as { livemode?: boolean }).livemode ?? null, // Refund carries livemode in JSON; SDK type omits it
            originalAmountCents: typeof rf.amount === "number" ? -rf.amount : null, // signed to match settled
            originalCurrency: rf.currency ?? null,
            chargeId: idOf((rf as unknown as { charge?: unknown }).charge),
            invoiceId: null,
            paymentIntentId: idOf((rf as unknown as { payment_intent?: unknown }).payment_intent),
            subscriptionId: null,
            customerId: null,
            billingReason: null,
            status: "refunded",
            periodStart: null,
            periodEnd: null,
          },
        });
      } else if (obj === "dispute") {
        const dp = src as Stripe.Dispute;
        const isReversal = (bt.amount ?? 0) > 0; // positive = won-back reversal (reconcile-only, not a webhook duty)
        inScope.push({
          bt,
          webhookResponsible: !isReversal,
          cap: {
            kind: "dispute",
            bt,
            livemode: dp.livemode,
            originalAmountCents: null,
            originalCurrency: bt.currency ?? null,
            chargeId: idOf((dp as unknown as { charge?: unknown }).charge),
            invoiceId: null,
            paymentIntentId: idOf((dp as unknown as { payment_intent?: unknown }).payment_intent),
            subscriptionId: null,
            customerId: null,
            billingReason: null,
            status: "dispute",
            periodStart: null,
            periodEnd: null,
          },
        });
      }
      // else: payout / stripe_fee / transfer / non-dispute adjustment → ignore
    }

    // 1b) Resolve Christmas gift candidates: a non-invoice charge is in scope only if
    //     its PaymentIntent is one of our campaign purchases. Matched by PI id against
    //     christmas_gift_2026_purchases (authoritative, no extra Stripe calls). These
    //     are webhook-responsible (payment_intent.succeeded), so a miss over the grace
    //     window is a real gap, same as an invoice-backed charge.
    if (christmasCandidates.length > 0) {
      const piIds = [...new Set(christmasCandidates.map((c) => c.piId))];
      const known = new Set<string>();
      for (let i = 0; i < piIds.length; i += 300) {
        const { data, error } = await admin
          .from("christmas_gift_2026_purchases")
          .select("stripe_payment_intent_id")
          .in("stripe_payment_intent_id", piIds.slice(i, i + 300));
        if (error) throw error;
        for (const r of data ?? []) known.add((r as { stripe_payment_intent_id: string }).stripe_payment_intent_id);
      }
      for (const c of christmasCandidates) {
        if (!known.has(c.piId)) continue;
        inScope.push({
          bt: c.bt,
          webhookResponsible: true,
          cap: {
            kind: "charge",
            bt: c.bt,
            livemode: c.ch.livemode,
            originalAmountCents: c.ch.amount ?? null,
            originalCurrency: c.ch.currency ?? null,
            chargeId: c.ch.id,
            invoiceId: null,
            paymentIntentId: c.piId,
            subscriptionId: null,
            customerId: idOf((c.ch as unknown as { customer?: unknown }).customer),
            billingReason: "christmas_gift_2026",
            status: "paid",
            periodStart: null,
            periodEnd: null,
          },
        });
      }
    }

    // 2) Which are already in the ledger? (chunked IN() over the in-scope bt ids)
    const present = new Set<string>();
    const btIds = inScope.map((x) => x.bt.id);
    for (let i = 0; i < btIds.length; i += 300) {
      const { data, error } = await admin
        .from("subscription_payments")
        .select("balance_transaction_id")
        .in("balance_transaction_id", btIds.slice(i, i + 300));
      if (error) throw error;
      for (const r of data ?? []) present.add((r as { balance_transaction_id: string }).balance_transaction_id);
    }

    // 3) Backfill the missing; classify alert-worthy gaps.
    const missing = inScope.filter((x) => !present.has(x.bt.id));
    const gapBtIds: string[] = [];
    let backfilled = 0;
    for (const m of missing) {
      // Enrich a missing invoice-charge with subscription / billing_reason / period
      // from the invoice (matches capturePaidInvoice). Best-effort; the canonical
      // settled figure is already on the balance transaction regardless.
      if (m.cap.kind === "charge" && m.cap.invoiceId) {
        try {
          const inv = await stripe.invoices.retrieve(m.cap.invoiceId);
          m.cap.subscriptionId = idOf((inv as unknown as { subscription?: unknown }).subscription);
          m.cap.billingReason = (inv as unknown as { billing_reason?: string }).billing_reason ?? null;
          m.cap.periodStart = tsIso((inv as unknown as { period_start?: number }).period_start);
          m.cap.periodEnd = tsIso((inv as unknown as { period_end?: number }).period_end);
        } catch {
          /* enrichment is best-effort */
        }
      }
      if (!dryRun) {
        try {
          // NOTE — the "gaps_over_grace>0 AND backfilled=0" signature. upsert uses
          // ON CONFLICT (balance_transaction_id) DO NOTHING and counts only true
          // inserts. If a concurrent writer (e.g. a Stripe webhook retry) has an
          // in-flight, uncommitted insert of this same bt at this instant, DO NOTHING
          // does NOT wait — it no-ops (inserted=false) and defers to that writer. If
          // that writer then fails/rolls back (the exact livemode-guard failure mode),
          // this run logs the gap but writes nothing, and the row stays missing until
          // the NEXT run re-inserts it (no race the second time → self-heals). Seen
          // 2026-08-13 (bt txn_3U3Hfy…UixBIVp). So a run with gaps_over_grace>0 and
          // backfilled=0 means "detected, deferred to a concurrent write that didn't
          // land" — NOT "the safety net can't write." If this recurs, that's why.
          const { inserted } = await upsertSubscriptionPayment(admin, m.cap);
          if (inserted) backfilled++;
        } catch (e) {
          console.error(`[reconcile-payments] failed to backfill ${m.bt.id} (${m.cap.kind}):`, e);
          continue;
        }
      }
      if (m.webhookResponsible && startedMs - (m.bt.created ?? 0) * 1000 > GRACE_MS) {
        gapBtIds.push(m.bt.id);
      }
    }

    const durationMs = Date.now() - startedMs;
    const gapsOverGrace = gapBtIds.length;
    const summary = {
      window_start: windowStartIso,
      window_days: days,
      scanned,
      in_scope: inScope.length,
      already_present: inScope.length - missing.length,
      backfilled,
      gaps_over_grace: gapsOverGrace,
      gap_bt_ids: gapBtIds,
      dry_run: dryRun,
      error: null as string | null,
      duration_ms: durationMs,
    };

    await recordRun(summary);

    if (gapsOverGrace > 0) {
      console.error(
        `[reconcile-payments] GAP: ${gapsOverGrace} webhook-responsible payment(s) were missing beyond the ${GRACE_MS / 3600000}h grace window and ${dryRun ? "would be" : "were"} backfilled — a webhook capture is silently failing. bt_ids=${gapBtIds.join(",")}`,
      );
      if (!dryRun) {
        await sendGapAlert(gapBtIds, days, backfilled).catch((e) =>
          console.error("[reconcile-payments] gap alert email failed:", e),
        );
        // Tier 3 emergency: a webhook capture is silently failing again (the exact
        // class of bug fixed 2026-08-06 — payment processing quietly broken). SMS,
        // scoped to entity "webhook" so a lingering break re-texts at most once per
        // 4h; a later clean run (below) resolves it.
        await sendSmsAlert({
          alertType: SMS_ALERT.STRIPE_WEBHOOK_GAP,
          entityKey: "webhook",
          message: `Stripe webhook is silently failing — ${gapsOverGrace} payment(s) missed capture and were backfilled. Payment processing may be broken.`,
          detail: `Reconcile found ${gapsOverGrace} webhook-responsible payment(s) missing beyond the grace window (look-back ${days}d). bt_ids=${gapBtIds.join(", ")}. Check the Stripe webhook, STRIPE_SECRET_KEY, and recent deploys.`,
        }).catch((e) => console.error("[reconcile-payments] gap SMS alert failed:", e));
      }
    } else if (!dryRun) {
      // Clean run (no gaps) confirms the webhook is capturing again → reset the
      // cooldown so a fresh break alerts immediately rather than being muffled.
      await resolveSmsAlert({ alertType: SMS_ALERT.STRIPE_WEBHOOK_GAP, entityKey: "webhook" }).catch((e) =>
        console.error("[reconcile-payments] gap resolve failed:", e),
      );
    }

    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "reconcile_failed";
    console.error("[reconcile-payments] run failed:", e);
    await recordRun({
      window_start: windowStartIso,
      window_days: days,
      scanned: 0,
      in_scope: 0,
      already_present: 0,
      backfilled: 0,
      gaps_over_grace: 0,
      gap_bt_ids: [],
      dry_run: dryRun,
      error: msg,
      duration_ms: Date.now() - startedMs,
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/** Email Iain when the reconcile finds a real gap (webhook silently failed to
 *  capture a payment). Best-effort; sent from Resend's always-available sender to
 *  the account owner so it works even before itsgodyo.com is a verified sender. */
async function sendGapAlert(btIds: string[], days: number, backfilled: number): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("[reconcile-payments] RESEND_API_KEY not set — gap alert email skipped");
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "It's God, Yo! Ops <onboarding@resend.dev>",
      to: ["iaindeckard@gmail.com"],
      subject: `⚠️ subscription_payments gap: ${btIds.length} missing payment row(s)`,
      text:
        `The reconciliation job found ${btIds.length} payment(s) the Stripe webhook should have captured but did not ` +
        `(older than the 2h grace window) and backfilled ${backfilled}.\n\n` +
        `This means a webhook capture is silently failing (safeCapture swallowed it). ` +
        `Check the Stripe webhook, STRIPE_SECRET_KEY, and any recent deploys.\n\n` +
        `Look-back: ${days} days\n` +
        `Balance transactions: ${btIds.join(", ")}\n\n` +
        `Tables: subscription_payments · payment_reconciliation_runs`,
    }),
  });
  if (!res.ok) throw new Error(`resend_${res.status}: ${(await res.text()).slice(0, 200)}`);
}
