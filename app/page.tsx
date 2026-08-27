import Landing from "@/components/Landing";

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://itsgodyo.com/#organization",
      name: "It's God, Yo!",
      legalName: "Deckard Enterprise International, LLC",
      url: "https://itsgodyo.com",
      logo: "https://itsgodyo.com/icon.svg",
    },
    {
      "@type": "Service",
      "@id": "https://itsgodyo.com/#service",
      name: "It's God, Yo! daily scripture text service",
      description:
        "A parent-paid service that sends a teen one daily scripture message by text, grounded in the King James Version.",
      url: "https://itsgodyo.com",
      provider: { "@id": "https://itsgodyo.com/#organization" },
      areaServed: "US",
      audience: {
        "@type": "Audience",
        audienceType: "Parents, caregivers, teens, youth groups, and churches",
      },
    },
  ],
};

// No page-level metadata — the homepage inherits the site-wide locked defaults
// (title/description/OG/Twitter + OG image) from app/layout.tsx.
export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <Landing />
    </>
  );
}
