import SignupFlow from "./SignupFlow";
import type { Lang } from "@/lib/i18n";
import { PURCHASES_ENABLED, PREORDER_MODE, SPANISH_ENABLED } from "@/lib/flags";

export const metadata = {
  title: "Get started — It's God, Yo!™",
};

function ComingSoon() {
  return (
    <main style={{ minHeight: "100vh", background: "#0B1830", color: "#fff", fontFamily: "'Poppins',system-ui,sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
      <div style={{ maxWidth: 460, textAlign: "center" }}>
        <div style={{ fontSize: 34, marginBottom: 14 }} aria-hidden="true">🙏</div>
        <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 12 }}>Signups are opening soon.</h1>
        <p style={{ color: "#a9bad6", lineHeight: 1.65, fontSize: 15 }}>
          We&rsquo;re putting the finishing touches on It&rsquo;s God, Yo. Signups aren&rsquo;t open yet, so there&rsquo;s nothing to pay and no card to enter right now. Please check back soon.
        </p>
        <p style={{ marginTop: 24 }}>
          <a href="/" style={{ color: "#7ea8e0", fontSize: 14 }}>&larr; Back home</a>
        </p>
      </div>
    </main>
  );
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string; plan?: string }>;
}) {
  const sp = await searchParams;
  // Hard block unless purchases are live OR we're in preorder (reserve) mode.
  // Preorder opens the flow to SAVE a card without charging (see lib/flags.ts).
  if (!PURCHASES_ENABLED && !PREORDER_MODE) return <ComingSoon />;
  // Ignore ?lang=es while Spanish is gated — signup is English-only.
  const initialLang: Lang = SPANISH_ENABLED && sp.lang === "es" ? "es" : "en";
  return <SignupFlow initialLang={initialLang} initialPlan={sp.plan} />;
}
