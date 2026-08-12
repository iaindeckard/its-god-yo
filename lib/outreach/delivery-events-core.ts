export type DeliveryLifecycleStatus =
  | "sent" | "delivered" | "delayed" | "bounced" | "complained" | "suppressed" | "failed";

const STATUS_BY_EVENT: Record<string, DeliveryLifecycleStatus> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.suppressed": "suppressed",
  "email.failed": "failed",
};

export function lifecycleStatus(eventType: string): DeliveryLifecycleStatus | null {
  return STATUS_BY_EVENT[eventType] ?? null;
}

export function providerMessageId(data: Record<string, unknown> | undefined): string | null {
  const value = data?.email_id ?? data?.id;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function eventOccurredAt(value: unknown, fallback = new Date()): string {
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  return fallback.toISOString();
}
