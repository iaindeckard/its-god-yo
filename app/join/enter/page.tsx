import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CORNERSTONE_ENABLED } from "@/lib/flags";

export const metadata: Metadata = {
  title: "Join with your church code | It's God, Yo!™",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const NAVY = "#0B1830";
const GOLD = "#FFDC52";

/**
 * "Enter your church code" fallback for the group enrollment link. Reached when a
 * teen opens /join without a valid link, or types a code by hand. Pure server
 * component — the form GETs /join?code=..., which validates and redirects into
 * signup. Never reveals whether a given code exists (a bad one just re-lands here).
 */
export default async function JoinEnterPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  if (!CORNERSTONE_ENABLED) notFound();
  const { code } = await searchParams;
  const triedBadCode = typeof code === "string" && code.trim().length > 0;

  return (
    <main style={{ minHeight: "100vh", background: NAVY, color: "#fff", fontFamily: "'Poppins',system-ui,sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
      <div style={{ maxWidth: 440, width: "100%", textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 12 }} aria-hidden="true">⛪</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 10 }}>Join with your church</h1>
        <p style={{ color: "#a9bad6", lineHeight: 1.6, fontSize: 15, marginBottom: 24 }}>
          Enter the code your church shared, and we&rsquo;ll take you to sign up. You&rsquo;ll still
          enter your own info and confirm by text. Nothing changes except that your church
          gets credit for bringing you in.
        </p>
        {triedBadCode && (
          <p style={{ color: "#ffd7d7", background: "rgba(255,80,80,0.12)", borderRadius: 8, padding: "10px 12px", fontSize: 14, marginBottom: 16 }}>
            We didn&rsquo;t recognize that code. Double-check it with your church and try again.
          </p>
        )}
        <form action="/join" method="get" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input
            name="code"
            defaultValue={triedBadCode ? code : ""}
            placeholder="ABCD-2345"
            autoCapitalize="characters"
            autoComplete="off"
            aria-label="Church code"
            style={{ padding: "14px 16px", borderRadius: 10, border: "1px solid #2a3a5a", background: "#0f2140", color: "#fff", fontSize: 18, letterSpacing: "0.12em", textAlign: "center", textTransform: "uppercase" }}
          />
          <button
            type="submit"
            style={{ padding: "14px 16px", borderRadius: 10, border: "none", background: GOLD, color: NAVY, fontWeight: 700, fontSize: 16, cursor: "pointer" }}
          >
            Continue
          </button>
        </form>
        <p style={{ marginTop: 22 }}>
          <a href="/signup" style={{ color: "#7ea8e0", fontSize: 14 }}>Sign up without a church code</a>
        </p>
      </div>
    </main>
  );
}
