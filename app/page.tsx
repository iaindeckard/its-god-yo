import type { Metadata } from "next";
import Landing from "@/components/Landing";

export const metadata: Metadata = {
  title: "It's God, Yo! — Faith that fits in a text",
  description:
    "A daily verse, texted the way you'd actually read it. Scripture as short, casual messages — grounded in the King James Version (English) and Reina-Valera 1909 (Spanish), both public domain.",
};

export default function Home() {
  return <Landing />;
}
