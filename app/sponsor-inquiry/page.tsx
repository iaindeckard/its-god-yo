import type { Metadata } from "next";
import InquiryForm from "./InquiryForm";

export const metadata: Metadata = {
  title: "Interested in sponsoring? — It's God, Yo!",
  description: "Churches, schools, and organizations who share the mission help make It's God, Yo possible. Start a conversation.",
};

export const dynamic = "force-dynamic";

export default function SponsorInquiryPage() {
  return <InquiryForm />;
}
