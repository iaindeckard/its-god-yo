import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import ReferralShare from "@/components/ReferralShare";

export const dynamic = "force-dynamic";
export const metadata = { title: "Signup status | It's God, Yo!™", robots: { index: false, follow: false } };

export default async function SignupStatusPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const admin = getSupabaseAdmin();
  const { data: access } = token ? await admin.from("signup_status_tokens").select("pending_signup_id,expires_at").eq("token", token).gt("expires_at", new Date().toISOString()).maybeSingle() : { data: null };
  if (!access) return <StatusCard title="This status link is unavailable." body="It may have expired. Contact support if you still need help activating the daily message." />;
  const [{ data: signup }, { data: consents }] = await Promise.all([
    admin.from("pending_signups").select("status,plan_key,created_at,subscription_created_at").eq("id", access.pending_signup_id).single(),
    admin.from("consent_log").select("consent_status,confirmation_sent_at,confirmation_reply_at").eq("pending_signup_id", access.pending_signup_id),
  ]);
  const confirmed = (consents ?? []).filter((c) => c.confirmation_reply_at).length;
  const total = (consents ?? []).length;
  const active = !!signup?.subscription_created_at;
  return <StatusCard active={active} title={active ? "You’re active." : "Waiting for confirmation."} body={active ? "The subscription is active and daily delivery can begin." : `${confirmed} of ${total || 1} recipients have replied YES. No charge is made for a recipient until they confirm.`} details={[`Plan: ${signup?.plan_key ?? "pending"}`, `Signup status: ${signup?.status ?? "pending"}`, active ? "Subscription created" : "Consent message sent"]} />;
}

function StatusCard({ title, body, details = [], active = false }: { title: string; body: string; details?: string[]; active?: boolean }) {
  return <main style={{ maxWidth: 620, margin: "0 auto", padding: "64px 24px" }}><div className="card"><h1 style={{ fontSize: 28, marginBottom: 10 }}>{title}</h1><p className="muted">{body}</p>{details.length > 0 && <ul style={{ margin: "18px 0", paddingLeft: 20 }}>{details.map((d) => <li key={d}>{d}</li>)}</ul>}<p className="hint">If the phone number is wrong or the confirmation text did not arrive, contact support before starting over.</p>{active && <ReferralShare />}<Link className="btn btn-ghost" href="/" style={{ marginTop: 16 }}>Back home</Link></div></main>;
}
