import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getShareableReferralForCustomer, ownerKindForPlan } from "@/lib/referral";
import WelcomeForm from "./WelcomeForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set your daily time | It's God, Yo!™" };

const PAGE_BG = "#0B1830";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: PAGE_BG,
        color: "#fff",
        fontFamily: "'Poppins',system-ui,sans-serif",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 40,
      }}
    >
      <div style={{ maxWidth: 480, width: "100%" }}>{children}</div>
    </main>
  );
}

/**
 * Teen welcome page (Stage 2, Option A). Reached from the post-YES "You're all
 * set!" SMS: itsgodyo.com/welcome?c=<welcome_token>. Lets the teen pick their
 * daily send time (30-min slots, 7 AM floor, default noon) and confirm their
 * timezone. The token is the only credential; it resolves to exactly one
 * consent_log row. If it never gets opened, defaults (noon + the fallback tz
 * chain) apply — nothing blocks on this page.
 */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c } = await searchParams;
  const token = (c ?? "").trim();

  let row:
    | { recipient_first_name: string | null; language: string | null; send_time_local: string | null; timezone: string | null; pending_signup_id: string | null }
    | null = null;
  // The purchaser's shareable referral (get-or-create), or null when they're not
  // eligible (a church/group buyer or a Cornerstone Partner). Resolved off the
  // pending_signups row the consent links to, since that carries the Stripe
  // customer + plan. Best-effort: a failure here never blocks the welcome page.
  let referral: { code: string; url: string } | null = null;

  if (token) {
    const admin = getSupabaseAdmin();
    const { data } = await admin
      .from("consent_log")
      .select("recipient_first_name, language, send_time_local, timezone, pending_signup_id")
      .eq("welcome_token", token)
      .maybeSingle();
    if (data) row = data;

    if (row?.pending_signup_id) {
      try {
        const { data: ps } = await admin
          .from("pending_signups")
          .select("stripe_customer_id, plan_key")
          .eq("id", row.pending_signup_id)
          .maybeSingle();
        const psRow = ps as { stripe_customer_id: string | null; plan_key: string | null } | null;
        if (psRow?.stripe_customer_id) {
          referral = await getShareableReferralForCustomer(psRow.stripe_customer_id, ownerKindForPlan(psRow.plan_key));
        }
      } catch (e) {
        console.error("[welcome] referral resolve failed:", e instanceof Error ? e.message : e);
      }
    }
  }

  if (!row) {
    return (
      <Shell>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 34, marginBottom: 14 }} aria-hidden="true">🙏</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12 }}>This link isn&rsquo;t valid.</h1>
          <p style={{ color: "#a9bad6", lineHeight: 1.65, fontSize: 15 }}>
            The link may be old or incomplete. Use the most recent link from your confirmation text. Your daily verse
            still arrives around noon your time until you pick a time.
          </p>
        </div>
      </Shell>
    );
  }

  const lang = row.language === "es" ? "es" : "en";
  return (
    <Shell>
      <WelcomeForm
        token={token}
        firstName={row.recipient_first_name}
        lang={lang}
        initialTime={row.send_time_local}
        initialTz={row.timezone}
        referralCode={referral?.code ?? null}
        referralUrl={referral?.url ?? null}
      />
    </Shell>
  );
}
