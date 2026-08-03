import { notFound } from "next/navigation";
import { getStripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { verifyRetryAccessToken } from "@/lib/preorder/token";
import RetryCard from "./RetryCard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Update your card — It's God, Yo!™", robots: { index: false, follow: false } };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ minHeight: "100vh", background: "#0B1830", color: "#fff", fontFamily: "'Poppins',system-ui,sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
      <div style={{ maxWidth: 480, width: "100%" }}>{children}</div>
    </main>
  );
}

export default async function PreorderRetryPage({
  searchParams,
}: {
  searchParams: Promise<{ ps?: string; t?: string }>;
}) {
  const sp = await searchParams;
  const ps = sp.ps ?? "";
  const t = sp.t ?? "";
  // Invalid id or token is indistinguishable from "not found" (like Cornerstone).
  if (!UUID_RE.test(ps) || !verifyRetryAccessToken(ps, t)) notFound();

  const admin = getSupabaseAdmin();
  const { data: row } = await admin
    .from("pending_signups")
    .select("id, status, is_preorder, stripe_customer_id")
    .eq("id", ps)
    .maybeSingle();
  if (!row || !row.is_preorder) notFound();

  // Valid token, but nothing to retry (already active, removed, or never failed).
  if (row.status !== "payment_failed") {
    const msg =
      row.status === "active"
        ? "You're all set — your subscription is active. Nothing more to do here. 🙏"
        : row.status === "removed"
        ? "This reservation has expired. To join, please sign up again."
        : "There's nothing to update on this link right now.";
    return (
      <Shell>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 34, marginBottom: 14 }} aria-hidden="true">🙏</div>
          <p style={{ color: "#a9bad6", lineHeight: 1.65, fontSize: 15 }}>{msg}</p>
          <p style={{ marginTop: 20 }}><a href="/" style={{ color: "#7ea8e0", fontSize: 14 }}>&larr; Back home</a></p>
        </div>
      </Shell>
    );
  }

  if (!row.stripe_customer_id) {
    return (
      <Shell>
        <div style={{ textAlign: "center", color: "#a9bad6" }}>We couldn&rsquo;t load your payment details. Please try again shortly.</div>
      </Shell>
    );
  }

  // Fresh SetupIntent on the EXISTING customer so the new card attaches to them.
  const stripe = getStripe();
  const setupIntent = await stripe.setupIntents.create({
    customer: row.stripe_customer_id,
    usage: "off_session",
    payment_method_types: ["card"],
    metadata: { source: "itsgodyo_preorder_retry", pending_signup_id: ps },
  });

  return (
    <Shell>
      <RetryCard ps={ps} t={t} clientSecret={setupIntent.client_secret!} />
    </Shell>
  );
}
