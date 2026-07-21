import { NextResponse } from "next/server";
import { createSubscriptionForPendingSignup } from "@/lib/createSubscription";

export const dynamic = "force-dynamic";

/**
 * Internal trigger for deferred subscription creation. Stands in for the future
 * Twilio "YES" SMS handler (which will look up the pending_signup by the
 * replying phone number and call the same creator). Protected by a shared
 * secret so it is NOT publicly invokable — this eventually creates real charges.
 */
export async function POST(req: Request) {
  const secret = process.env.INTERNAL_CONFIRM_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  if (!body.pending_signup_id) {
    return NextResponse.json({ error: "pending_signup_id is required" }, { status: 400 });
  }
  try {
    const result = await createSubscriptionForPendingSignup(body.pending_signup_id);
    const code =
      result.status === "created" || result.status === "already_created" ? 200
        : result.status === "blocked_enhanced" ? 409
        : result.status === "not_found" ? 404
        : 422;
    return NextResponse.json(result, { status: code });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
