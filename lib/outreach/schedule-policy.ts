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
