const FOLLOWUP_DAYS = 30;

export function validTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function nextReleaseAt(releasedAt: string): string {
  return new Date(new Date(releasedAt).getTime() + FOLLOWUP_DAYS * 86_400_000).toISOString();
}

/** Touch-2 fires 30 days after Touch-1 ACTUALLY completes sending. It takes ONLY
 *  the completion instant by design: there is deliberately no parameter for the
 *  scheduled release_at, so a caller cannot reintroduce the drift bug where a
 *  delayed send (closed gate, retry, stale-claim recovery) still anchored Touch-2
 *  to its original, now-stale scheduled time. */
export function touchTwoReleaseAt(touchOneCompletedAt: string): string {
  return nextReleaseAt(touchOneCompletedAt);
}

/** A scheduled audience must never silently advance when an approved recipient
 * was excluded by a runtime gate. Human review is required before retrying or
 * changing the snapshot/allowlist. */
export function hasAudienceBlocker(items: Array<{ outcome: string }>): boolean {
  return items.some(({ outcome }) =>
    outcome === "skipped_allowlist" || outcome === "skipped_unverified"
  );
}
