import "server-only";

/**
 * Encoding-aware SMS segment counter, matching the spec's §1.3 gate
 * (docs/VERSE-LENGTH-AND-FIDELITY-SPEC.md): GSM-7 = 160 single / 153 per
 * concatenated segment (extension chars cost 2 septets); anything outside GSM-7
 * (emoji, accented Spanish, em/curly punctuation, …) forces UCS-2 = 70 single /
 * 67 per segment (UTF-16 code units, so a surrogate-pair emoji counts as 2).
 *
 * Used by the DM-opener fit-guard to keep every send within 2 segments.
 */

const GSM7_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1bÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡" +
  "ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
);
// Characters that exist in GSM-7 only via the escape table -> cost 2 septets.
const GSM7_EXT = new Set("^{}\\[~]|€");

function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (!GSM7_BASIC.has(ch) && !GSM7_EXT.has(ch)) return false;
  }
  return true;
}

function gsm7Septets(text: string): number {
  let n = 0;
  for (const ch of text) n += GSM7_EXT.has(ch) ? 2 : 1;
  return n;
}

/** Number of SMS segments this body will send as. */
export function smsSegments(text: string): number {
  if (isGsm7(text)) {
    const n = gsm7Septets(text);
    return n <= 160 ? 1 : Math.ceil(n / 153);
  }
  // UCS-2: JS string length is the UTF-16 code-unit count (surrogate pairs = 2).
  const units = text.length;
  return units <= 70 ? 1 : Math.ceil(units / 67);
}
