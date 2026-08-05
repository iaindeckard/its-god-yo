import type { Metadata } from "next";
import { notFound } from "next/navigation";
import InquiryForm from "./InquiryForm";
import { SPONSORS_ENABLED } from "@/lib/flags";

export const metadata: Metadata = {
  title: "Interested in sponsoring? | It's God, Yo!™",
  description: "Churches, schools, and organizations who share the mission help make It's God, Yo possible. Start a conversation.",
};

export const dynamic = "force-dynamic";

export default function SponsorInquiryPage() {
  // Sponsor Program deprioritized 2026-08-01 — hidden from public view (see lib/flags).
  if (!SPONSORS_ENABLED) notFound();
  return <InquiryForm />;
}
