/**
 * Canonical phone helpers — shared by BOTH client and server (NO `server-only`
 * so it is safe in the browser bundle).
 *
 * The rule this module enforces, and the reason it exists:
 *   - STORE / SEND on the canonical E.164 form (`toE164`). Everything persisted to
 *     consent_log.recipient_phone and everything handed to Twilio must be E.164 so
 *     there is exactly ONE representation of a number in the system.
 *   - MATCH on `phoneKey` (digits-only, last-10). Matching is deliberately tolerant
 *     of country-code prefix differences (`+1` vs `+52`) and of any legacy rows
 *     that predate canonicalization, so an inbound STOP/YES still finds its row.
 *
 * Historically two different `normalizePhone` helpers disagreed (lib/twilio.ts
 * produced last-10 digits; lib/consent.ts produced E.164), which let the same
 * phone be stored/looked-up two ways. Both now delegate here.
 */

type Country = "US" | "CA" | "MX";

/**
 * Canonical E.164 for STORAGE and SENDING. Idempotent: an E.164 input returns the
 * same value. Fixes the old MX mis-normalization — a bare 10-digit MX number with
 * `country:'MX'` becomes `+52…`, no longer wrongly `+1…`.
 *
 * Rules:
 *  - trim first.
 *  - if it starts with `+`, strip spaces/dashes/parens and return (already E.164).
 *  - else reduce to digits:
 *      - 11 digits with a leading `1`  -> `+<digits>` (NANP with country code).
 *      - 10 digits                     -> prefix by country (MX -> +52, US/CA/default -> +1).
 *      - anything else                 -> best-effort cleaned (`+<digits>` if we have digits).
 */
export function toE164(raw: string | null | undefined, country?: Country): string {
  const trimmed = (raw ?? "").trim();
  if (trimmed.startsWith("+")) {
    // Already E.164-ish: keep the leading + and drop human separators only.
    return "+" + trimmed.slice(1).replace(/[\s\-().]/g, "");
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) {
    const cc = country === "MX" ? "52" : "1"; // US / CA / default -> +1
    return `+${cc}${digits}`;
  }
  // Best-effort: no confident country/length. Preserve digits behind a + so the
  // value is still comparable via phoneKey; empty stays empty.
  return digits ? `+${digits}` : trimmed;
}

/**
 * Build canonical E.164 from a country dial code + a nationally-formatted number,
 * as produced by the signup country picker (user selects country, types only the
 * local number). Idempotent-ish escape hatch: if the user pasted a full `+…`
 * number anyway, we respect it and ignore the picker. A single leading domestic
 * trunk `0` (common in the UK/EU) is dropped; US/CA/MX national numbers have no
 * leading 0 so they are unaffected.
 */
export function toE164FromParts(dial: string | null | undefined, national: string | null | undefined): string {
  const raw = (national ?? "").trim();
  if (raw.startsWith("+")) return toE164(raw); // user typed a full international number — respect it
  const dd = (dial ?? "").replace(/\D/g, "");
  const d = raw.replace(/\D/g, "").replace(/^0+/, ""); // drop domestic trunk zero(s)
  if (!d) return "";
  return `+${dd}${d}`;
}

/**
 * Tolerant matching key: digits-only, last-10. Robust to `+1` vs `+52` prefix
 * differences (they get dropped) and to non-canonical legacy formats. Use this —
 * never a raw string equality — to match an inbound Twilio `From` against stored
 * recipient_phone values.
 */
export function phoneKey(raw: string | null | undefined): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}
