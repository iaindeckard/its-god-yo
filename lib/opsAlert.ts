import "server-only";

/**
 * Shared ops alert — the SAME mechanism the reconcile-payments gap alert uses
 * (Resend email to the account owner, best-effort, no-op without a key). Factored
 * here so new alerts (e.g. the season T-14 content-review alarm) reuse one channel
 * instead of each re-implementing it. Sent from Resend's always-available sender so
 * it works even before itsgodyo.com is a verified sender.
 */
export async function sendOpsAlert(args: { subject: string; text: string }): Promise<{ dispatched: boolean }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn(`[ops-alert] RESEND_API_KEY not set — "${args.subject}" not emailed`);
    return { dispatched: false };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "It's God, Yo! Ops <onboarding@resend.dev>",
      to: ["iaindeckard@gmail.com"],
      subject: args.subject,
      text: args.text,
    }),
  });
  if (!res.ok) throw new Error(`resend_${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { dispatched: true };
}
