import { notFound } from "next/navigation";
import { PILOT_RECRUITMENT_ENABLED } from "@/lib/flags";
import PilotForm from "./PilotForm";

export default async function PilotPage({ searchParams }: { searchParams: Promise<{ audience?: string }> }) {
  if (!PILOT_RECRUITMENT_ENABLED) notFound();
  const { audience } = await searchParams;
  return <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px" }}>
    <p className="strong">IGY FOUNDING PILOT</p>
    <h1>Seven days to build the habit. Then one verse each week, free.</h1>
    <p className="muted">A bounded 100–250-recipient learning cohort for families and churches. Recipients still consent themselves. Pilot participation never guarantees publication of a quote or story.</p>
    <div className="card" style={{ margin: "24px 0" }}>
      <h2>What participants get</h2>
      <p>Seven daily scripture texts, followed by a weekly free message. Daily service remains available as a paid upgrade. STOP always stops messages.</p>
    </div>
    <PilotForm initialAudience={audience === "church" ? "church" : "family"} />
  </main>;
}
