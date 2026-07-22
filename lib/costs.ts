/**
 * Real cost constants gathered 2026-07-22 from the actual accounts.
 *
 * Twilio: the IGY account is on standard US A2P pay-as-you-go pricing (no
 * committed-use tier). The Twilio portion of a US outbound SMS is $0.0079 per
 * message SEGMENT; US carrier pass-through fees are separate and vary by carrier
 * (~$0.003/segment for 10DLC). These are the per-send DEFAULTS the Twilio send
 * path should stamp onto each igy_sms_log row (unit_price_cents / carrier_fee_
 * cents) so historical cost stays exact even if pricing changes. Twilio is
 * currently INERT (no credentials) so no messages are sent and no cost accrues.
 *
 * Confirm the exact rate in the Twilio console once credentials exist; if a
 * different tier applies, update these constants (new sends capture the new
 * price; already-logged rows keep the price they were sent at).
 */
export const TWILIO_US_SEGMENT_PRICE_CENTS = 0.79; // Twilio portion, per segment
export const TWILIO_US_CARRIER_FEE_CENTS = 0.3; // approx US 10DLC carrier pass-through, per segment

/** Exact cost of one outbound SMS, in cents, for the igy_sms_log row. */
export function smsCostCents(
  segments: number,
  unitPriceCents = TWILIO_US_SEGMENT_PRICE_CENTS,
  carrierFeeCentsPerSegment = TWILIO_US_CARRIER_FEE_CENTS,
): number {
  return segments * unitPriceCents + segments * carrierFeeCentsPerSegment;
}
