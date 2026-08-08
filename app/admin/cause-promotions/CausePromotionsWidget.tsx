"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CausePromotionTotal } from "@/lib/causePromotions";

const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

const PHASE_STYLE: Record<string, string> = {
  scheduled: "bg-slate-100 text-slate-600",
  active: "bg-emerald-100 text-emerald-700",
  closed: "bg-amber-100 text-amber-700",
};

export default function CausePromotionsWidget({ initialTotals }: { initialTotals: CausePromotionTotal[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const refresh = () => startTransition(() => {
    router.refresh();
    setLastRefreshed(new Date());
  });

  // Real-time feel: auto-refresh hourly. On-demand via the button.
  useEffect(() => {
    const id = setInterval(refresh, 60 * 60 * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Cause Promotions</h1>
          <p className="text-sm text-slate-500">
            Realized (money actually collected) and potential (in-trial, if they convert) are tracked separately. Payout is pledged on realized only.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={isPending}
          className="text-sm font-semibold px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {isPending ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {lastRefreshed && (
        <p className="text-xs text-slate-400 mb-3">Last refreshed {lastRefreshed.toLocaleTimeString()}. Auto-refreshes hourly.</p>
      )}

      {initialTotals.length === 0 ? (
        <p className="text-sm text-slate-500">No promotions configured.</p>
      ) : (
        <div className="space-y-4">
          {initialTotals.map((p) => (
            <div key={p.promotion_id} className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <h2 className="font-semibold text-slate-900">{p.charity_name}</h2>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${PHASE_STYLE[p.phase] ?? "bg-slate-100 text-slate-600"}`}>
                    {p.phase}
                  </span>
                  <span className="text-xs text-slate-400">{Math.round(p.payout_rate * 100)}% of net</span>
                </div>
                <span className="text-xs text-slate-400">
                  {fmtDate(p.start_at)} to {fmtDate(p.end_at)}
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Metric label="Contributed so far" hint="realized, settled money" value={usd(p.realized_net_cents)} strong />
                <Metric label="Pending if trials convert" hint="potential, in-trial" value={usd(p.potential_cents)} muted />
                <Metric label={`Pledged payout (${Math.round(p.payout_rate * 100)}%)`} hint="on realized only" value={usd(p.payout_cents)} />
                <Metric
                  label="Members"
                  hint={`${p.realized_members} paid / ${p.trial_members} in trial`}
                  value={String(p.member_subscriptions)}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Metric({ label, hint, value, strong, muted }: { label: string; hint: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div>
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`text-lg font-bold ${strong ? "text-emerald-700" : muted ? "text-slate-400" : "text-slate-900"}`}>{value}</p>
      <p className="text-[11px] text-slate-400">{hint}</p>
    </div>
  );
}
