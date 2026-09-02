import type { DiscoveredLead } from "./leads";
import type { SearchLanguage } from "./campaigns";

export interface OfficialChurchDirectory {
  id: string;
  name: string;
  denomination: string;
  entryUrl: string;
  domains: readonly string[];
  // Language a directory is scoped to. Omitted / "en" = a general (English)
  // national locator, used by default campaigns. "es" = a Spanish-speaking-church
  // directory, used only when a campaign's search_language is "es" (it is kept out
  // of the default English lane rotation).
  language?: SearchLanguage;
  // A third-party (non-denominational) aggregator directory rather than a national
  // church body's own locator. Candidates from it are capped at "medium"
  // confidence, the same tier as the secondary-web fallback (see
  // applyDirectorySourcePolicy).
  thirdParty?: boolean;
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
  {
    // Spanish-speaking-church campaigns have no single official denominational
    // locator, so we seed candidate identity from this public multi-tradition
    // Spanish-church directory. As with every directory here, it establishes
    // candidate identity only — the office email and youth signal must still be
    // qualified on the congregation's OWN site (applyDirectorySourcePolicy).
    id: "cdusa-spanish",
    name: "ChurchDirectoryUSA Spanish-Speaking Churches",
    denomination: "Spanish-speaking (multi-tradition)",
    entryUrl: "https://www.churchdirectoryusa.com/spanish-speaking-churches",
    domains: ["churchdirectoryusa.com"],
    language: "es",
    thirdParty: true,
  },
] as const;

/** National locators used by default (English) campaigns. Excludes the
 *  language-scoped Spanish directory so it never enters the English rotation. */
export function generalDirectories(): OfficialChurchDirectory[] {
  return OFFICIAL_CHURCH_DIRECTORIES.filter((d) => (d.language ?? "en") === "en");
}

/** Directories scoped to Spanish-speaking churches. */
export function spanishDirectories(): OfficialChurchDirectory[] {
  return OFFICIAL_CHURCH_DIRECTORIES.filter((d) => d.language === "es");
}

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
  return generalDirectories()
    .map((directory) => `- ${directory.denomination}: ${directory.entryUrl}`)
    .join("\n");
}

export interface DiscoverySourceLane {
  directory: OfficialChurchDirectory | null;
  label: string;
}

export function validDirectoryIds(ids: string[] | null | undefined): string[] {
  if (!ids?.length) return [];
  const allowed = new Set(OFFICIAL_CHURCH_DIRECTORIES.map((directory) => directory.id));
  return [...new Set(ids.map((id) => id.trim()).filter((id) => allowed.has(id)))];
}

export function selectedDirectories(ids: string[] | null | undefined): OfficialChurchDirectory[] {
  const selected = new Set(validDirectoryIds(ids));
  return selected.size === 0
    ? [...OFFICIAL_CHURCH_DIRECTORIES]
    : OFFICIAL_CHURCH_DIRECTORIES.filter((directory) => selected.has(directory.id));
}

/**
 * The ordered set of candidate source lanes for a campaign, given its
 * denomination filter and language.
 *
 * English ("en"): the selected national directories, or all general directories
 * plus a trailing secondary-web fallback (null) when nothing is selected.
 *
 * Spanish ("es"): the Spanish-speaking-church directory first, then any general
 * directories the campaign explicitly selected (e.g. a Catholic+Spanish campaign
 * keeps USCCB), then a secondary-web fallback. The English default rotation is
 * NOT used, so a Spanish campaign stays focused on Spanish-speaking candidates.
 */
function laneSet(
  denominationFilter: string[] | null | undefined,
  language: SearchLanguage = "en",
): Array<OfficialChurchDirectory | null> {
  if (language === "es") {
    const ids = validDirectoryIds(denominationFilter);
    // Only fold in directories the campaign EXPLICITLY selected (e.g. Catholic +
    // Spanish keeps USCCB). No filter => Spanish directory + secondary web only.
    const explicit = ids.length
      ? selectedDirectories(ids).filter((d) => (d.language ?? "en") === "en")
      : [];
    return [...spanishDirectories(), ...explicit, null];
  }
  const selected = validDirectoryIds(denominationFilter);
  return selected.length ? selectedDirectories(selected) : [...generalDirectories(), null];
}

export function discoverySourceLaneCount(
  ids: string[] | null | undefined,
  language: SearchLanguage = "en",
): number {
  return laneSet(ids, language).length;
}

/**
 * Keep each provider request on one bounded source lane. Rounds cycle through the
 * campaign's lane set (see laneSet); the exclusion list prevents duplicate
 * organizations across rounds.
 */
export function discoverySourceLane(
  roundCount: number,
  denominationFilter?: string[] | null,
  language: SearchLanguage = "en",
): DiscoverySourceLane {
  const lanes = laneSet(denominationFilter, language);
  const index = Math.max(0, Math.floor(roundCount)) % lanes.length;
  const directory = lanes[index];
  return {
    directory,
    label: directory ? `${directory.denomination}: ${directory.entryUrl}` : "secondary web fallback",
  };
}

/**
 * Convert the model's role-specific citations into the existing source_urls
 * evidence trail. A false "official_directory" claim is downgraded rather than
 * trusted, and secondary-web candidates can never be high confidence. Third-party
 * (non-denominational) aggregator directories are capped at the same "medium"
 * tier as secondary web, since they are not a church body's own locator.
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
  // Cap at "medium" for the secondary-web fallback AND for third-party aggregator
  // directories (e.g. the Spanish directory) — neither is a denomination's own locator.
  const capMedium = method === "secondary_web" || Boolean(directory?.thirdParty);
  const confidence = capMedium && lead.discovery_confidence === "high"
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
