/**
 * Real cost constants gathered 2026-07-22 from the actual accounts.
 *
 * Twilio: the IGY account is on standard US pay-as-you-go pricing (no
 * committed-use tier). The Twilio portion of a US outbound SMS is $0.0079 per
 * message SEGMENT regardless of number type. The separate US carrier fee DOES
 * depend on number type:
 *   - Toll-free (our chosen launch path): ~$0.0025/segment.
 *   - 10DLC long code: ~$0.003/segment (kept below for a future 10DLC migration).
 * These are the per-send DEFAULTS the Twilio send path stamps onto each
 * igy_sms_log row (unit_price_cents / carrier_fee_cents) so historical cost
 * stays exact even if pricing changes. Twilio is currently INERT (no
 * credentials) so no messages are sent and no cost accrues.
 *
 * Confirm the exact rate in the Twilio console once credentials exist; if a
 * different tier applies, update these constants (new sends capture the new
 * price; already-logged rows keep the price they were sent at).
 */
export const TWILIO_US_SEGMENT_PRICE_CENTS = 0.79; // Twilio portion, per segment (number-type-independent)
export const TWILIO_US_TOLLFREE_CARRIER_FEE_CENTS = 0.25; // approx US toll-free carrier fee, per segment (launch path)
export const TWILIO_US_10DLC_CARRIER_FEE_CENTS = 0.3; // approx US 10DLC carrier pass-through, per segment (future migration)

/** Exact cost of one outbound SMS, in cents, for the igy_sms_log row. Defaults to
 *  the toll-free carrier fee (IGY's launch sending path); pass the 10DLC constant
 *  if/when the account migrates to a 10DLC long code. */
export function smsCostCents(
  segments: number,
  unitPriceCents = TWILIO_US_SEGMENT_PRICE_CENTS,
  carrierFeeCentsPerSegment = TWILIO_US_TOLLFREE_CARRIER_FEE_CENTS,
): number {
  return segments * unitPriceCents + segments * carrierFeeCentsPerSegment;
}
