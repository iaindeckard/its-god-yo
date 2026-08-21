/**
 * One-off LA test harness for the Catholic K-12 Schools discovery mode.
 *
 * It exercises the REAL shipped school logic (imported from lib/outreach/
 * school-sources.ts): the school system/user prompts, the diocesan source lanes,
 * applySchoolLeadPolicy, and the CHS-New-Iberia exclusion. Only the OpenAI HTTP
 * call is driven here (with the local OPENAI_API_KEY) instead of through the
 * server's durable-run wrapper, because the Supabase service key isn't available
 * locally — dedup + insert are done separately via the Supabase MCP.
 *
 * Run: npx tsx scripts/discover-catholic-schools-test.ts LA
 * Prints JSON: { candidates: [...], excludedHits: n, exclusionUnitTest: {...} }
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  schoolDiscoverySystem,
  schoolUserPrompt,
  schoolSourceLane,
  schoolSourceLaneCount,
  applySchoolLeadPolicy,
  isExcludedSchoolLead,
} from "../lib/outreach/school-sources";
import { applyAttendanceSourcePolicy } from "../lib/outreach/size-sources";
import { isCreditExhaustedError, discoveryPrimaryProvider } from "../lib/outreach/discovery-core";
import { anthropicDiscoverLeads, anthropicDiscoveryAvailable, ANTHROPIC_DISCOVERY_MODEL } from "../lib/outreach/anthropic-discovery";
import type { DiscoveredLead } from "../lib/outreach/leads";

function loadEnvLocal(): void {
  try {
    const raw = readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* no .env.local */ }
}

const LEAD_PROPERTIES = {
  org_name: { type: "string" }, city: { type: "string" }, state: { type: "string" },
  denomination_type: { type: ["string", "null"] }, contact_email: { type: "string" },
  phone: { type: ["string", "null"] }, website: { type: ["string", "null"] },
  youth_ministry_signal: { type: "string" }, source_urls: { type: "array", items: { type: "string" } },
  directory_source_url: { type: ["string", "null"] }, contact_source_url: { type: "string" },
  youth_source_url: { type: "string" },
  discovery_method: { type: "string", enum: ["official_directory", "secondary_web"] },
  discovery_confidence: { type: "string", enum: ["high", "medium", "low"] },
  estimated_attendance: { type: ["integer", "null"] }, attendance_source_url: { type: ["string", "null"] },
} as const;

async function callOpenAI(system: string, prompt: string, maxLeads: number, key: string): Promise<{ raw: string; leads: unknown[] }> {
  const body = {
    model: process.env.OUTREACH_OPENAI_MODEL || "gpt-5-mini",
    store: false,
    instructions: system,
    input: prompt,
    max_output_tokens: 4000,
    max_tool_calls: 15,
    reasoning: { effort: "low" },
    tools: [{ type: "web_search", search_context_size: "low" }],
    text: { format: { type: "json_schema", name: "school_discovery", strict: true, schema: {
      type: "object", additionalProperties: false, required: ["leads"], properties: {
        leads: { type: "array", maxItems: maxLeads, items: { type: "object", additionalProperties: false,
          required: Object.keys(LEAD_PROPERTIES), properties: LEAD_PROPERTIES } },
      },
    } } },
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 150_000);
  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`openai_${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json() as { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
    const text = data.output_text ?? (data.output ?? []).flatMap((i) => i.content ?? [])
      .filter((c) => c.type === "output_text").map((c) => c.text ?? "").join("\n");
    let leads: unknown[] = [];
    try { leads = (JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1))?.leads) ?? []; } catch { /* */ }
    return { raw: text, leads };
  } finally {
    clearTimeout(timer);
  }
}

/** Mirror of the production provider-order failover: run the PRIMARY provider
 *  (OUTREACH_DISCOVERY_PRIMARY, default openai) for this lane, and on a
 *  credit-exhaustion error fall over to the OTHER provider (same system + prompt).
 *  Returns the raw leads plus which provider served them. */
async function discoverWithFailover(system: string, prompt: string, key: string): Promise<{ leads: unknown[]; provider: "openai" | "anthropic" }> {
  const runOpenai = async () => (await callOpenAI(system, prompt, 4, key)).leads;
  const runAnthropic = async () => (await anthropicDiscoverLeads({ system, prompt })).leads;
  if (discoveryPrimaryProvider() === "anthropic") {
    try {
      return { leads: await runAnthropic(), provider: "anthropic" };
    } catch (e) {
      if (isCreditExhaustedError(e) && key) {
        console.error("  ↳ Anthropic credit exhausted; failing over to OpenAI");
        return { leads: await runOpenai(), provider: "openai" };
      }
      throw e;
    }
  }
  try {
    return { leads: await runOpenai(), provider: "openai" };
  } catch (e) {
    if (isCreditExhaustedError(e) && anthropicDiscoveryAvailable()) {
      console.error(`  ↳ OpenAI credit exhausted; failing over to Anthropic (${ANTHROPIC_DISCOVERY_MODEL})`);
      return { leads: await runAnthropic(), provider: "anthropic" };
    }
    throw e;
  }
}

async function main() {
  loadEnvLocal();
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set (checked env + .env.local)");
  const state = (process.argv[2] || "LA").toUpperCase();
  const laneCount = schoolSourceLaneCount(state);
  // Resume support: argv[3] is the 1-indexed lane to START from (default 1). e.g.
  // `... LA 3` resumes at lane 3 (round index 2), skipping lanes already done.
  const startLane = Math.max(1, Math.min(laneCount, Number(process.argv[3] || 1)));
  const startRound = startLane - 1;
  console.error(`[test] state=${state} primary=${discoveryPrimaryProvider()} anthropicKey=${anthropicDiscoveryAvailable()} lanes=${startLane}..${laneCount}`);

  // --- Exclusion unit test: a CHS-shaped candidate MUST be dropped ---
  const chsSynthetic: DiscoveredLead = {
    org_name: "Catholic High School", city: "New Iberia", state: "LA",
    contact_email: "office@chspanthers.com", website: "https://www.chspanthers.com",
    contact_source_url: "https://www.chspanthers.com/contact", youth_source_url: "https://www.chspanthers.com/academics",
    directory_source_url: "https://en.wikipedia.org/wiki/List_of_schools_in_the_Roman_Catholic_Diocese_of_Lafayette_in_Louisiana",
    source_urls: ["https://www.chspanthers.com/contact"], discovery_confidence: "high",
  };
  const chsByDomain = isExcludedSchoolLead({ org_name: "St. X", city: "Y", website: "https://chspanthers.com" });
  const chsByName = isExcludedSchoolLead({ org_name: "Catholic High School", city: "New Iberia" });
  const chsPolicyDrops = applySchoolLeadPolicy(chsSynthetic) === null;

  const candidates: DiscoveredLead[] = [];
  const seen = new Set<string>();
  let excludedHits = 0;
  let failedOverLanes = 0;
  const rawByLane: Array<{ lane: string; returned: number; kept: number; excluded: number; provider?: string }> = [];

  for (let round = startRound; round < laneCount; round++) {
    const lane = schoolSourceLane(round, state);
    const system = schoolDiscoverySystem(state);
    const prompt = schoolUserPrompt(state, 4, [...seen], lane.label);
    let leads: unknown[] = [];
    let provider: "openai" | "anthropic" = "openai";
    try { ({ leads, provider } = await discoverWithFailover(system, prompt, key)); if (provider === "anthropic") failedOverLanes++; }
    catch (e) { rawByLane.push({ lane: lane.label, returned: -1, kept: 0, excluded: 0 }); console.error(`lane "${lane.label}" error:`, e instanceof Error ? e.message : e); continue; }
    let kept = 0, excluded = 0;
    for (const l of leads as DiscoveredLead[]) {
      if (!l || !l.org_name || !l.contact_email) continue;
      if (isExcludedSchoolLead(l)) { excluded++; excludedHits++; continue; }
      const policied = applySchoolLeadPolicy(l);
      if (!policied) continue;
      const withSize = applyAttendanceSourcePolicy(policied);
      const dupeKey = withSize.org_name.toLowerCase();
      if (seen.has(dupeKey)) continue;
      seen.add(dupeKey);
      candidates.push(withSize);
      kept++;
    }
    rawByLane.push({ lane: lane.label, returned: (leads as unknown[]).length, kept, excluded, provider });
  }

  // Targeted probe: explicitly ask for New Iberia Catholic high schools to try to
  // surface CHS from real discovery and confirm the pipeline filters it out.
  const probe = await discoverWithFailover(
    schoolDiscoverySystem(state),
    "Find Roman Catholic high schools located specifically in New Iberia, Louisiana. Return every one you can find with its office email and website.",
    key,
  ).catch((e) => ({ leads: [] as unknown[], provider: "openai" as const, error: String(e) }));
  const probeCHS = (probe.leads as DiscoveredLead[]).filter((l) => l && isExcludedSchoolLead(l));
  const probeSurfaced = (probe.leads as DiscoveredLead[]).map((l) => l?.org_name).filter(Boolean);

  console.log(JSON.stringify({
    state, laneCount, startLane, primary: discoveryPrimaryProvider(),
    exclusionUnitTest: { chsByDomain, chsByName, chsPolicyDrops },
    rawByLane,
    failedOverLanes,
    anthropicFailoverConfigured: anthropicDiscoveryAvailable(),
    excludedHits,
    probe: { surfaced: probeSurfaced, chsCaught: probeCHS.length },
    candidateCount: candidates.length,
    candidates,
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
