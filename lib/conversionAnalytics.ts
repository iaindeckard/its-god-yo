export const CONVERSION_EVENTS = [
  "landing_view", "audience_selected", "sample_viewed", "signup_started",
  "focus_selected", "plan_selected", "recipient_completed", "payment_saved",
  "consent_sent", "consent_confirmed", "subscription_activated",
  "first_message_delivered", "referral_shared", "church_interest_submitted",
  "freemium_started", "freemium_upgraded", "freemium_weekly_transition",
  "cancelled", "opted_out",
] as const;

export type ConversionEventName = (typeof CONVERSION_EVENTS)[number];

const SESSION_KEY = "igy_funnel_session_v1";

function sessionId(): string {
  const existing = window.sessionStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.sessionStorage.setItem(SESSION_KEY, created);
  return created;
}

export function trackConversion(
  event_name: ConversionEventName,
  properties: Record<string, string | number | boolean | null> | undefined = undefined,
) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const body = JSON.stringify({
    session_id: sessionId(), event_name, page_path: url.pathname,
    acquisition_source: url.searchParams.get("utm_source"),
    acquisition_medium: url.searchParams.get("utm_medium"),
    acquisition_campaign: url.searchParams.get("utm_campaign"),
    properties: properties ?? {},
  });
  if (navigator.sendBeacon) {
    navigator.sendBeacon("/api/analytics/event", new Blob([body], { type: "application/json" }));
  } else {
    void fetch("/api/analytics/event", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true });
  }
}
