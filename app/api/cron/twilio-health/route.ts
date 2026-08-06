import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cronAuth";
import { sendSmsAlert, resolveSmsAlert, SMS_ALERT } from "@/lib/smsAlert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Tier 3 Twilio health check (signal chosen by Iain): poll Twilio's own API for
 * the authoritative account state rather than inferring from delivery failures.
 * Alerts if the account is not 'active' (suspended/closed), if the API rejects our
 * credentials (auth revoked), or if the configured from-number is no longer on the
 * account (released/verification revoked). Each condition resolves when it clears,
 * so a fresh outage re-alerts promptly instead of waiting out a stale cooldown.
 *
 * If the account IS down, the emergency SMS itself can't send — sendSmsAlert falls
 * back to the ops-alert email automatically, so the signal is never lost.
 *
 * No-op (200) without Twilio credentials, so it is safe while Twilio is pending.
 * Authorized by a CRON_SECRET bearer (auto-sent by Vercel Cron).
 */
export async function GET(req: Request) {
  const authed = isAuthorizedCron(req);
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token) return NextResponse.json({ ok: true, skipped: "twilio_not_configured" });

  const basic = Buffer.from(`${sid}:${token}`).toString("base64");
  const headers = { Authorization: `Basic ${basic}` };

  // 1) Account status (also catches auth-revoked via a non-200).
  let accountIssue: string | null = null;
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, { headers });
    if (!r.ok) {
      accountIssue = `Twilio account API returned ${r.status}${r.status === 401 ? " (credentials rejected, auth may be revoked)" : ""}`;
    } else {
      const j = (await r.json()) as { status?: string };
      if (j.status && j.status !== "active") accountIssue = `Twilio account status is '${j.status}' (not active)`;
    }
  } catch (e) {
    accountIssue = `Twilio account check failed: ${e instanceof Error ? e.message : String(e)}`;
  }

  // 2) From-number ownership — only meaningful if the account check itself passed
  //    (a failed auth already tells us everything and would also fail here).
  let numberIssue: string | null = null;
  const numberChecked = !!from && accountIssue === null;
  if (numberChecked) {
    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(from!)}`;
      const r = await fetch(url, { headers });
      if (!r.ok) {
        numberIssue = `Twilio number lookup returned ${r.status}`;
      } else {
        const j = (await r.json()) as { incoming_phone_numbers?: unknown[] };
        if ((j.incoming_phone_numbers ?? []).length === 0) {
          numberIssue = `Twilio from-number ${from} is no longer on the account (released or revoked)`;
        }
      }
    } catch (e) {
      numberIssue = `Twilio number check failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // 3) Fire or resolve, scoped per condition so they cool down independently.
  if (accountIssue) {
    await sendSmsAlert({
      alertType: SMS_ALERT.TWILIO_ACCOUNT,
      entityKey: "account",
      message: `${accountIssue}. Subscriber SMS delivery is at risk.`,
      detail: `${accountIssue}. Detected by the twilio-health cron. Check the Twilio console (account standing, billing, toll-free verification).`,
    }).catch((e) => console.error("[twilio-health] account alert failed:", e));
  } else {
    await resolveSmsAlert({ alertType: SMS_ALERT.TWILIO_ACCOUNT, entityKey: "account" }).catch(() => {});
  }

  if (numberIssue) {
    await sendSmsAlert({
      alertType: SMS_ALERT.TWILIO_ACCOUNT,
      entityKey: "number",
      message: `${numberIssue}.`,
      detail: `${numberIssue}. Detected by the twilio-health cron. Verify the number in the Twilio console.`,
    }).catch((e) => console.error("[twilio-health] number alert failed:", e));
  } else if (numberChecked) {
    await resolveSmsAlert({ alertType: SMS_ALERT.TWILIO_ACCOUNT, entityKey: "number" }).catch(() => {});
  }

  return NextResponse.json({
    ok: true,
    account_ok: !accountIssue,
    number_ok: numberChecked ? !numberIssue : null,
    account_issue: accountIssue,
    number_issue: numberIssue,
  });
}
