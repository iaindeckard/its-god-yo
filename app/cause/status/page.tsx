import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CAUSE_PUBLIC_ENABLED } from "@/lib/flags";
import { verifyCauseStatusToken } from "@/lib/cause/token";
import { getCustomerCauseContribution } from "@/lib/causePromotions";

export const metadata: Metadata = {
  title: "Your giving impact | It's God, Yo!™",
  robots: { index: false, follow: false }, // private, token-gated — never index
};

export const dynamic = "force-dynamic";

const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/**
 * Customer-facing cause-promotion status page. Built now, kept DARK: two gates must
 * both pass — the global CAUSE_PUBLIC_ENABLED flag AND the promotion's own
 * customer_facing_enabled column (enforced in getCustomerCauseContribution). Access
 * is a signed, non-expiring HMAC token over the Stripe customer id (lib/cause/token),
 * the same no-login shape as the Cornerstone status and season-manage links — IGY
 * has no customer login and we are not adding one. Any failure (flag off, bad/missing
 * token, no customer-facing promotion) is an indistinguishable 404. A customer only
 * ever sees their OWN contribution.
 */
export default async function CauseStatusPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; t?: string }>;
}) {
  if (!CAUSE_PUBLIC_ENABLED) notFound();
  const { c, t } = await searchParams;
  if (!c || !t || !verifyCauseStatusToken(c, t)) notFound();

  const contributions = await getCustomerCauseContribution(c);
  if (!contributions.length) notFound(); // no customer-facing promotion to show

  return (
    <main className="max-w-xl mx-auto px-6 py-12">
      <h1 className="text-2xl font-bold text-slate-900 mb-2">Your giving impact</h1>
      <p className="text-sm text-slate-500 mb-8">
        Thank you. Here is how your subscription is supporting these causes.
      </p>

      <div className="space-y-6">
        {contributions.map((c) => (
          <div key={c.promotion_id} className="rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="font-semibold text-slate-900">{c.public_title || c.charity_name}</h2>
            {c.public_blurb && <p className="text-sm text-slate-500 mt-1">{c.public_blurb}</p>}

            <div className="grid grid-cols-2 gap-4 mt-5">
              <div>
                <p className="text-xs text-slate-400">Contributed so far</p>
                <p className="text-2xl font-bold text-emerald-700">{usd(c.my_realized_cents)}</p>
                <p className="text-[11px] text-slate-400">from payments already collected</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Pending, if your trial converts</p>
                <p className="text-2xl font-bold text-slate-400">{usd(c.my_potential_cents)}</p>
                <p className="text-[11px] text-slate-400">not yet collected</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
