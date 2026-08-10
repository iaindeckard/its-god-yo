export type AccessTier = "paid_daily" | "free_daily_trial" | "free_weekly";

export function localWeekday(nowMs: number, timezone: string): number {
  const short = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(new Date(nowMs));
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(short);
}

export function freemiumDeliveryAllowed(input: {
  enabled: boolean; tier?: AccessTier | null; weeklySendDow?: number | null;
  nowMs: number; timezone: string;
}): boolean {
  if (!input.enabled || !input.tier || input.tier !== "free_weekly") return true;
  return localWeekday(input.nowMs, input.timezone) === (input.weeklySendDow ?? 0);
}
