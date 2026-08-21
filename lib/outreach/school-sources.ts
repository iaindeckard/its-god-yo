import type { DiscoveredLead } from "./leads";

/**
 * Catholic K-12 SCHOOL discovery sources (parallel to directory-sources.ts, which
 * covers church/youth-ministry directories).
 *
 * The church pipeline searches national denominational congregation locators for
 * congregations with an active youth ministry. Schools are a different entity:
 * the candidate source is a diocese's list of its Catholic schools, not a parish
 * locator, and the qualification signal is "this is a Catholic K-12 school with a
 * public office/admissions inbox", not "has a youth ministry".
 *
 * Priority of sources (spec §2):
 *   a. Wikipedia "List of schools in the Roman Catholic (Arch)diocese of X" pages
 *      — confirmed to exist for ~30 (arch)dioceses.
 *   b. For dioceses without a Wikipedia list: that diocese's own official
 *      school-directory page, and/or the NCEA school locator.
 *   c. Per-school contact enrichment (principal/admissions/office email) on the
 *      school's own site — same per-lead evidence step the church pipeline uses.
 *
 * This module is intentionally free of `server-only` and of any runtime deps (like
 * directory-sources.ts / discovery-core.ts) so it can be imported by both the
 * server discovery agent and a plain test/CLI runner.
 */

export const NCEA_SCHOOL_LOCATOR_URL = "https://www.ncea.org/NCEA/Proclaim/Catholic_School_Data/NCEA/Proclaim/Catholic_School_Data/Catholic_School_Data.aspx";
export const WIKIPEDIA_CATHOLIC_SCHOOLS_CATEGORY = "https://en.wikipedia.org/wiki/Category:Lists_of_Catholic_schools_in_the_United_States";

export interface DioceseSchoolList {
  /** (Arch)diocese short name, e.g. "New Orleans", "Lafayette in Louisiana". */
  diocese: string;
  /** Two-letter US state code the (arch)diocese is seated in. */
  state: string;
  /** Confirmed Wikipedia "List of schools in the Roman Catholic (Arch)diocese of X"
   *  page, when one exists; null => use the diocese's own directory / NCEA. */
  wikipediaListUrl: string | null;
  /** The diocese's official school-directory / schools-office page, when known.
   *  Used as the (b) fallback and as per-school enrichment context. */
  officialDirectoryUrl?: string | null;
}

/**
 * Seed set of (arch)dioceses. Louisiana is complete (the test state, and the home
 * of the excluded CHS New Iberia — which sits in the Diocese of Lafayette, so that
 * diocese's list MUST be searched *and* filtered). The rest are a representative
 * national set covering the ~30 Wikipedia school-list dioceses named in the spec.
 * The prompt also instructs the model to discover a state's other dioceses on its
 * own, so this list is a strong starting point, not an exhaustive registry.
 */
export const DIOCESE_SCHOOL_LISTS: readonly DioceseSchoolList[] = [
  // --- Louisiana (complete) ---
  { diocese: "New Orleans", state: "LA", wikipediaListUrl: "https://en.wikipedia.org/wiki/List_of_schools_in_the_Roman_Catholic_Archdiocese_of_New_Orleans", officialDirectoryUrl: "https://catholicschools.arch-no.org/" },
  { diocese: "Baton Rouge", state: "LA", wikipediaListUrl: "https://en.wikipedia.org/wiki/List_of_schools_in_the_Roman_Catholic_Diocese_of_Baton_Rouge", officialDirectoryUrl: "https://diobrschools.org/" },
  { diocese: "Lafayette in Louisiana", state: "LA", wikipediaListUrl: "https://en.wikipedia.org/wiki/List_of_schools_in_the_Roman_Catholic_Diocese_of_Lafayette_in_Louisiana", officialDirectoryUrl: "https://catholicschoolslafayette.org/" },
  { diocese: "Lake Charles", state: "LA", wikipediaListUrl: null, officialDirectoryUrl: "https://lcdiocese.org/catholic-schools" },
  { diocese: "Alexandria", state: "LA", wikipediaListUrl: null, officialDirectoryUrl: "https://diocesealex.org/our-faith/catholic-schools/" },
  { diocese: "Houma-Thibodaux", state: "LA", wikipediaListUrl: null, officialDirectoryUrl: "https://htdiocese.org/schools" },
  { diocese: "Shreveport", state: "LA", wikipediaListUrl: null, officialDirectoryUrl: "https://www.dioshpt.org/catholic-schools" },

  // --- Representative national set (Wikipedia school lists confirmed by the spec) ---
  { diocese: "Atlanta", state: "GA", wikipediaListUrl: "https://en.wikipedia.org/wiki/List_of_schools_in_the_Roman_Catholic_Archdiocese_of_Atlanta" },
  { diocese: "Baltimore", state: "MD", wikipediaListUrl: "https://en.wikipedia.org/wiki/List_of_schools_in_the_Roman_Catholic_Archdiocese_of_Baltimore" },
  { diocese: "Boston", state: "MA", wikipediaListUrl: "https://en.wikipedia.org/wiki/List_of_schools_in_the_Roman_Catholic_Archdiocese_of_Boston" },
  { diocese: "Brooklyn", state: "NY", wikipediaListUrl: "https://en.wikipedia.org/wiki/List_of_schools_in_the_Roman_Catholic_Diocese_of_Brooklyn" },
  { diocese: "Chicago", state: "IL", wikipediaListUrl: "https://en.wikipedia.org/wiki/List_of_schools_in_the_Roman_Catholic_Archdiocese_of_Chicago" },
  { diocese: "Corpus Christi", state: "TX", wikipediaListUrl: "https://en.wikipedia.org/wiki/List_of_schools_in_the_Roman_Catholic_Diocese_of_Corpus_Christi" },
  { diocese: "Des Moines", state: "IA", wikipediaListUrl: "https://en.wikipedia.org/wiki/List_of_schools_in_the_Roman_Catholic_Diocese_of_Des_Moines" },
  { diocese: "Detroit", state: "MI", wikipediaListUrl: "https://en.wikipedia.org/wiki/List_of_schools_in_the_Roman_Catholic_Archdiocese_of_Detroit" },
  { diocese: "Dubuque", state: "IA", wikipediaListUrl: "https://en.wikipedia.org/wiki/List_of_schools_in_the_Roman_Catholic_Archdiocese_of_Dubuque" },
  { diocese: "Fall River", state: "MA", wikipediaListUrl: "https://en.wikipedia.org/wiki/List_of_schools_in_the_Roman_Catholic_Diocese_of_Fall_River" },
  { diocese: "Hartford", state: "CT", wikipediaListUrl: "https://en.wikipedia.org/wiki/List_of_schools_in_the_Roman_Catholic_Archdiocese_of_Hartford" },
  { diocese: "Jackson", state: "MS", wikipediaListUrl: "https://en.wikipedia.org/wiki/List_of_schools_in_the_Roman_Catholic_Diocese_of_Jackson" },
  { diocese: "Los Angeles", state: "CA", wikipediaListUrl: "https://en.wikipedia.org/wiki/List_of_schools_in_the_Roman_Catholic_Archdiocese_of_Los_Angeles" },
  { diocese: "Louisville", state: "KY", wikipediaListUrl: "https://en.wikipedia.org/wiki/List_of_schools_in_the_Roman_Catholic_Archdiocese_of_Louisville" },
  { diocese: "Miami", state: "FL", wikipediaListUrl: "https://en.wikipedia.org/wiki/List_of_schools_in_the_Roman_Catholic_Archdiocese_of_Miami" },
  { diocese: "Milwaukee", state: "WI", wikipediaListUrl: "https://en.wikipedia.org/wiki/List_of_schools_in_the_Roman_Catholic_Archdiocese_of_Milwaukee" },
] as const;

const US_STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky",
  LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

export function stateName(code: string | null | undefined): string {
  const c = (code || "").trim().toUpperCase();
  return US_STATE_NAMES[c] ?? c;
}

/** The seeded (arch)dioceses for a state, in list order (Wikipedia-list ones first). */
export function schoolSourcesForState(stateCode: string | null | undefined): DioceseSchoolList[] {
  const c = (stateCode || "").trim().toUpperCase();
  const inState = DIOCESE_SCHOOL_LISTS.filter((d) => d.state === c);
  return [...inState].sort((a, b) => (a.wikipediaListUrl ? 0 : 1) - (b.wikipediaListUrl ? 0 : 1));
}

// ---- CHS New Iberia hard exclusion (spec §5) ------------------------------

/** Domains that must never appear in a Catholic-schools lead or send. */
export const EXCLUDED_SCHOOL_DOMAINS: readonly string[] = ["chspanthers.com"] as const;

function hostname(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function domainOf(email: string | null | undefined): string | null {
  const at = (email || "").trim().toLowerCase().split("@")[1];
  return at ? at.replace(/^www\./, "") : null;
}

function matchesExcludedDomain(host: string | null): boolean {
  if (!host) return false;
  return EXCLUDED_SCHOOL_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

function normalizeName(s: string | null | undefined): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Hard-exclude Catholic High School, New Iberia (spec §5). Two independent
 * matches, either of which excludes the lead:
 *   1. Any associated domain (website, contact email, or a cited source/directory
 *      URL) is chspanthers.com.
 *   2. The org name contains both "catholic high" and "new iberia".
 * Applied at discovery time (never inserted) and defensively at send time.
 */
export function isExcludedSchoolLead(lead: {
  org_name?: string | null;
  city?: string | null;
  website?: string | null;
  contact_email?: string | null;
  source_urls?: string[] | null;
  directory_source_url?: string | null;
  contact_source_url?: string | null;
  youth_source_url?: string | null;
}): boolean {
  const hosts = [
    hostname(lead.website),
    domainOf(lead.contact_email),
    hostname(lead.directory_source_url),
    hostname(lead.contact_source_url),
    hostname(lead.youth_source_url),
    ...((lead.source_urls ?? []).map((u) => hostname(u))),
  ];
  if (hosts.some(matchesExcludedDomain)) return true;

  const name = normalizeName(lead.org_name);
  const city = normalizeName(lead.city);
  if (name.includes("catholic high") && (name.includes("new iberia") || city.includes("new iberia"))) {
    return true;
  }
  return false;
}

// ---- Prompt construction --------------------------------------------------

/** The diocese/source starting points for a state, formatted for the prompt. */
export function schoolSourcePrompt(stateCode: string | null | undefined): string {
  const state = stateName(stateCode);
  const seeds = schoolSourcesForState(stateCode);
  const lines = seeds.map((d) => {
    const src = d.wikipediaListUrl
      ? `Wikipedia list: ${d.wikipediaListUrl}`
      : `official diocese school directory: ${d.officialDirectoryUrl ?? "(find the diocese's schools page)"}`;
    return `- (Arch)diocese of ${d.diocese} — ${src}`;
  });
  const seededBlock = lines.length
    ? `KNOWN (ARCH)DIOCESES IN ${state.toUpperCase()} (start here):\n${lines.join("\n")}`
    : `No (arch)dioceses are pre-seeded for ${state}. First enumerate the Roman Catholic (arch)dioceses whose territory covers ${state}, then for each search its "List of schools in the Roman Catholic (Arch)diocese of ..." Wikipedia page, then its official diocesan school directory, then the NCEA locator.`;
  return `${seededBlock}

If a listed (arch)diocese is missing a Wikipedia list, use its official diocesan school-directory page instead. The NCEA Catholic school locator (${NCEA_SCHOOL_LOCATOR_URL}) and the Wikipedia category (${WIKIPEDIA_CATHOLIC_SCHOOLS_CATEGORY}) are additional fallbacks. Also enumerate and search any OTHER Roman Catholic (arch)dioceses that cover ${state} but are not listed above.`;
}

/** System instructions for the school discovery pass (parallels discoverySystem). */
export function schoolDiscoverySystem(stateCode: string | null | undefined): string {
  const state = stateName(stateCode);
  return `You are a careful research assistant building an outreach lead list of Roman Catholic K-12 SCHOOLS (elementary, middle, and high schools) in the state of ${state}. These are SCHOOLS, not parishes/churches. Follow these NON-NEGOTIABLE rules:

1. Only include an organization that is a Roman Catholic K-12 school in ${state} with (a) a publicly posted GENERAL/OFFICE, ADMISSIONS, or PRINCIPAL'S-OFFICE contact email (e.g. office@, info@, admissions@, principal@, school@). NEVER an individual teacher's or named staff member's personal email. NEVER an email you guessed or inferred from a pattern — it must appear verbatim on a public page or a search-result snippet.
2. Respect robots.txt. If a site disallows automated access, do NOT fetch it directly — use only the search-indexed snippet, and lower confidence for that lead.
3. DISCOVER CANDIDATES FROM DIOCESAN SCHOOL LISTS FIRST, in this priority order: (a) the Wikipedia "List of schools in the Roman Catholic (Arch)diocese of X" pages, (b) the diocese's own official school-directory page, (c) the NCEA Catholic school locator. A directory/list establishes that the school exists and is Catholic; it does NOT by itself establish a usable public office inbox.
4. QUALIFY EACH SCHOOL ON ITS OWN WEBSITE. The public office/admissions email must appear on the school's own site or official page; return that page as contact_source_url. Return a page proving it is a Catholic K-12 school (about/academics/admissions page showing grade levels) as youth_source_url. Return the diocesan list/directory page you found it through as directory_source_url.
5. General web search is SECONDARY: use it to locate a school's own contact/admissions page, or to find schools only after the diocesan lists and directories are exhausted. For a secondary-web candidate, set directory_source_url to null and discovery_method to "secondary_web".
6. Do NOT use purchased, scraped, aggregator, map/review, or third-party contact-list data.
7. Every lead MUST cite the specific pages actually used. No un-sourced entries.
8. Prefer quality over quantity. Return fewer, well-sourced schools rather than padding. If it is unclear that a candidate is a currently-operating Catholic K-12 school, mark confidence "low" and explain in the school signal field.
9. HARD EXCLUSION: NEVER include Catholic High School in New Iberia, Louisiana (domain chspanthers.com). It is handled separately. Omit it from every result regardless of state or diocese.
10. Put the school's grade range and any stated enrollment (e.g. "PK-12, ~450 students") in the youth_ministry_signal field. Set estimated_attendance to a stated ENROLLMENT integer if one is publicly posted (cite it as attendance_source_url), else null. Never guess enrollment.

${schoolSourcePrompt(stateCode)}

Return ONLY a JSON object, no prose, of the form:
{"leads":[{"org_name","city","state","denomination_type","contact_email","phone","website","youth_ministry_signal","directory_source_url":"..." or null,"contact_source_url":"...","youth_source_url":"...","discovery_method":"official_directory|secondary_web","source_urls":["..."],"discovery_confidence":"high|medium|low","estimated_attendance":123 or null,"attendance_source_url":"..." or null}]}`;
}

/** Campaign-scoped user prompt for one school-discovery round. */
export function schoolUserPrompt(stateCode: string | null | undefined, target: number, exclude: string[], sourceLabel: string): string {
  const state = stateName(stateCode);
  const excludeLine = exclude.length
    ? ` Do NOT include any of these schools already found: ${exclude.slice(0, 60).join("; ")}.`
    : "";
  return `Find up to ${target} Roman Catholic K-12 schools in the state of ${state}. Use this candidate source lane: ${sourceLabel}. Qualify each school on its own website (office/admissions email + a page proving it is a Catholic K-12 school). Follow every rule and return every required evidence field. Never include Catholic High School, New Iberia (chspanthers.com).${excludeLine}`;
}

export interface SchoolSourceLane {
  label: string;
  /** Whether this lane is a diocesan list/directory (official) vs a web fallback. */
  official: boolean;
}

/**
 * One bounded source lane per round: cycle the state's seeded (arch)diocese lists,
 * then an NCEA/other-diocese fallback lane. The exclusion list prevents duplicates
 * as rounds repeat the cycle.
 */
export function schoolSourceLane(roundCount: number, stateCode: string | null | undefined): SchoolSourceLane {
  const seeds = schoolSourcesForState(stateCode);
  const lanes: SchoolSourceLane[] = seeds.map((d) => ({
    label: d.wikipediaListUrl
      ? `Diocese of ${d.diocese} — ${d.wikipediaListUrl}`
      : `Diocese of ${d.diocese} — ${d.officialDirectoryUrl ?? "official school directory"}`,
    official: true,
  }));
  lanes.push({ label: `NCEA locator + any other ${stateName(stateCode)} Catholic (arch)dioceses not yet searched`, official: false });
  const index = Math.max(0, Math.floor(roundCount)) % lanes.length;
  return lanes[index];
}

/** Number of distinct school source lanes for a state (used to bound rounds / the
 *  empty-streak stop, mirroring discoverySourceLaneCount for churches). */
export function schoolSourceLaneCount(stateCode: string | null | undefined): number {
  return schoolSourcesForState(stateCode).length + 1;
}

/**
 * Convert the model's role-specific citations into the standard source_urls trail,
 * decide official vs secondary provenance, and DROP the CHS exclusion. A Wikipedia
 * diocese list or a diocesan directory counts as an official-list source (may be
 * high confidence); anything else is secondary_web (capped at medium).
 */
export function applySchoolLeadPolicy(lead: DiscoveredLead): DiscoveredLead | null {
  if (isExcludedSchoolLead(lead)) return null;

  const contact = lead.contact_source_url?.trim();
  const evidence = lead.youth_source_url?.trim();
  if (!contact || !evidence || !hostname(contact) || !hostname(evidence)) return null;

  const directoryHost = hostname(lead.directory_source_url);
  const isOfficialList = Boolean(
    directoryHost &&
      (directoryHost === "en.wikipedia.org" ||
        directoryHost.endsWith(".wikipedia.org") ||
        /diocese|archdiocese|catholicschool|ncea\.org/.test(directoryHost) ||
        DIOCESE_SCHOOL_LISTS.some((d) => {
          const dh = hostname(d.officialDirectoryUrl);
          return dh ? directoryHost === dh || directoryHost.endsWith(`.${dh}`) : false;
        })),
  );
  const method: DiscoveredLead["discovery_method"] = isOfficialList ? "official_directory" : "secondary_web";
  const confidence =
    method === "secondary_web" && lead.discovery_confidence === "high" ? "medium" : lead.discovery_confidence;

  const sourceUrls = [contact, evidence, lead.directory_source_url, ...(lead.source_urls ?? [])].filter(
    (v): v is string => Boolean(v && hostname(v)),
  );

  return {
    ...lead,
    entity_type: "school",
    directory_source_url: isOfficialList ? lead.directory_source_url : null,
    discovery_method: method,
    discovery_confidence: confidence,
    source_urls: [...new Set(sourceUrls)],
  };
}
