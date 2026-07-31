import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import WelcomeForm from "./WelcomeForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set your daily time — It's God, Yo!" };

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
    | { recipient_first_name: string | null; language: string | null; send_time_local: string | null; timezone: string | null }
    | null = null;

  if (token) {
    const admin = getSupabaseAdmin();
    const { data } = await admin
      .from("consent_log")
      .select("recipient_first_name, language, send_time_local, timezone")
      .eq("welcome_token", token)
      .maybeSingle();
    if (data) row = data;
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
      />
    </Shell>
  );
}
