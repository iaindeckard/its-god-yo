import type { DiscoveredLead } from "./leads";

export interface OfficialChurchDirectory {
  id: string;
  name: string;
  denomination: string;
  entryUrl: string;
  domains: readonly string[];
}

/**
 * Public congregation locators operated by, or on the official domain of, a
 * national church body. They identify candidate congregations; they do not by
 * themselves prove an active youth ministry or a usable public office inbox.
 */
export const OFFICIAL_CHURCH_DIRECTORIES: readonly OfficialChurchDirectory[] = [
  {
    id: "usccb",
    name: "USCCB Find a Parish",
    denomination: "Roman Catholic",
    entryUrl: "https://www.usccb.org/mass-times",
    domains: ["usccb.org"],
  },
  {
    id: "episcopal",
    name: "The Episcopal Church Find a Church",
    denomination: "Episcopal",
    entryUrl: "https://www.episcopalchurch.org/find-a-church/",
    domains: ["episcopalchurch.org", "episcopalassetmap.org"],
  },
  {
    id: "umc",
    name: "United Methodist Find-A-Church",
    denomination: "United Methodist",
    entryUrl: "https://www.umc.org/en/find-a-church",
    domains: ["umc.org"],
  },
  {
    id: "elca",
    name: "ELCA Find a Congregation",
    denomination: "ELCA Lutheran",
    entryUrl: "https://www.elca.org/worship-with-us/find-a-congregation",
    domains: ["elca.org"],
  },
  {
    id: "pcusa",
    name: "Presbyterian Church (U.S.A.) Find a Church",
    denomination: "Presbyterian Church (U.S.A.)",
    entryUrl: "https://www.pcusa.org/congregations",
    domains: ["pcusa.org"],
  },
  {
    id: "sbc",
    name: "Southern Baptist Convention Churches Directory",
    denomination: "Southern Baptist",
    entryUrl: "https://churches.sbc.net/",
    domains: ["sbc.net"],
  },
  {
    id: "lcms",
    name: "LCMS Church Locator",
    denomination: "Lutheran Church-Missouri Synod",
    entryUrl: "https://locator.lcms.org/church",
    domains: ["lcms.org"],
  },
] as const;

function hostname(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function officialDirectoryForUrl(raw: string | null | undefined): OfficialChurchDirectory | null {
  const host = hostname(raw);
  if (!host) return null;
  return OFFICIAL_CHURCH_DIRECTORIES.find((directory) =>
    directory.domains.some((domain) => host === domain || host.endsWith(`.${domain}`)),
  ) ?? null;
}

export function directorySourcePrompt(): string {
  return OFFICIAL_CHURCH_DIRECTORIES
    .map((directory) => `- ${directory.denomination}: ${directory.entryUrl}`)
    .join("\n");
}

export interface DiscoverySourceLane {
  directory: OfficialChurchDirectory | null;
  label: string;
}

/**
 * Keep each provider request on one bounded source lane. Seven rounds cover the
 * official national directories; the eighth is a secondary-web fallback for
 * traditions without a listed national locator. Subsequent rounds repeat the
 * cycle while the exclusion list prevents duplicate organizations.
 */
export function discoverySourceLane(roundCount: number): DiscoverySourceLane {
  const index = Math.max(0, Math.floor(roundCount)) % (OFFICIAL_CHURCH_DIRECTORIES.length + 1);
  const directory = OFFICIAL_CHURCH_DIRECTORIES[index] ?? null;
  return {
    directory,
    label: directory ? `${directory.denomination}: ${directory.entryUrl}` : "secondary web fallback",
  };
}

/**
 * Convert the model's role-specific citations into the existing source_urls
 * evidence trail. A false "official_directory" claim is downgraded rather than
 * trusted, and secondary-web candidates can never be high confidence.
 */
export function applyDirectorySourcePolicy(lead: DiscoveredLead): DiscoveredLead | null {
  const directory = officialDirectoryForUrl(lead.directory_source_url);
  const method = directory ? "official_directory" : "secondary_web";
  const contact = lead.contact_source_url?.trim();
  const youth = lead.youth_source_url?.trim();
  if (!contact || !youth || !hostname(contact) || !hostname(youth)) return null;

  // Keep the contact page first: outreach email footers intentionally cite
  // source_urls[0] as the page where the public office address was found.
  // Candidate provenance remains explicit as the third role-specific citation.
  const sourceUrls = [contact, youth, lead.directory_source_url, ...(lead.source_urls ?? [])]
    .filter((value): value is string => Boolean(value && hostname(value)));
  const uniqueSources = [...new Set(sourceUrls)];
  const confidence = method === "secondary_web" && lead.discovery_confidence === "high"
    ? "medium"
    : lead.discovery_confidence;

  return {
    ...lead,
    directory_source_url: directory ? lead.directory_source_url : null,
    discovery_method: method,
    discovery_confidence: confidence,
    source_urls: uniqueSources,
  };
}
