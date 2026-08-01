import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CORNERSTONE_ENABLED } from "@/lib/flags";
import ApplicationForm from "./ApplicationForm";

export const metadata: Metadata = {
  title: "Become a Cornerstone Partner — It's God, Yo!™",
  description: "Churches that join during the founding stage of It's God, Yo are permanently recognized as Cornerstone Partners.",
};

export const dynamic = "force-dynamic";

export default function CornerstonePage() {
  // Program not open yet — hide the public intake entirely (see lib/flags).
  if (!CORNERSTONE_ENABLED) notFound();
  return <ApplicationForm />;
}
