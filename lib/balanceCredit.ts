import "server-only";
import { getStripe } from "./stripe";

/**
 * Canonical Stripe customer-balance adjustment, factored out of the referral credit
 * path so every feature (referral, and now the Christmas gift non-confirmation credit)
 * issues credits and clawbacks through ONE mechanism rather than a parallel copy. This
 * is the same primitive the bounty program uses inline (stripe.customers
 * .createBalanceTransaction with a negative amount); bounty keeps its bespoke
 * reconcile/status handling inline for now and can migrate to this helper later.
 *
 * "credit" reduces what the customer owes (negative balance = a credit toward their next
 * invoice); "debit" claws it back (positive). The caller owns its own ledger row and
 * status; this performs only the Stripe side and returns the balance-transaction id.
 *
 * Idempotency is the caller's responsibility via idempotencyKey. It MUST include the
 * customer id when one logical event issues multiple credits: Stripe rejects
 * idempotency-key reuse across different customer endpoints with a 400.
 */
export interface BalanceCreditResult {
  balanceTransactionId: string;
  livemode: boolean;
}

export async function issueBalanceCredit(args: {
  customerId: string;
  cents: number; // positive magnitude; the sign is applied from `direction`
  direction: "credit" | "debit";
  currency: string;
  description: string;
  idempotencyKey: string;
  metadata?: Record<string, string>;
}): Promise<BalanceCreditResult> {
  const stripe = getStripe();
  const amount = args.direction === "credit" ? -Math.abs(args.cents) : Math.abs(args.cents);
  const txn = await stripe.customers.createBalanceTransaction(
    args.customerId,
    {
      amount, // negative = credit, positive = debit (clawback)
      currency: args.currency,
      description: args.description,
      metadata: args.metadata ?? {},
    },
    { idempotencyKey: args.idempotencyKey },
  );
  return { balanceTransactionId: txn.id, livemode: txn.livemode };
}
