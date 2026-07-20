import SignupFlow from "./SignupFlow";
import type { Lang } from "@/lib/i18n";

export const metadata = {
  title: "Get started — It's God, Yo!",
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string; plan?: string }>;
}) {
  const sp = await searchParams;
  const initialLang: Lang = sp.lang === "es" ? "es" : "en";
  return <SignupFlow initialLang={initialLang} initialPlan={sp.plan} />;
}
