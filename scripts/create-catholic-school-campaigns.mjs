/**
 * Create the national Catholic K-12 Schools state campaigns (spec §1/§4).
 *
 * One campaign per US state (+ DC): geography_type 'state', discount_percent 10,
 * message_variant 'catholic_school', denomination_filter ['usccb'], status 'draft'.
 * Idempotent: a state that already has a catholic_school campaign is skipped, so
 * this is safe to re-run and to run incrementally.
 *
 * The shared promo code (APPRECIATION10) is NOT stored on the campaign — it is a
 * property of the 'catholic_school' variant in lib/outreach/templates.ts, so all
 * campaigns share it by construction. Discovery is NOT started here; that is a
 * separate, per-state, reviewed action.
 *
 *   node scripts/create-catholic-school-campaigns.mjs LA           # one/several states
 *   node scripts/create-catholic-school-campaigns.mjs --all        # every state + DC
 *   node scripts/create-catholic-school-campaigns.mjs --all --dry  # print, create nothing
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (IGY project).
 */
import { readFileSync } from "node:fs";

const STATES = {
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

function loadEnvLocal() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* none */ }
}

async function main() {
  loadEnvLocal();
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const all = args.includes("--all");
  const wanted = all
    ? Object.keys(STATES)
    : args.filter((a) => !a.startsWith("--")).map((a) => a.toUpperCase());
  if (!wanted.length) {
    console.error("Usage: node scripts/create-catholic-school-campaigns.mjs <STATE...|--all> [--dry]");
    process.exit(1);
  }
  const bad = wanted.filter((s) => !STATES[s]);
  if (bad.length) { console.error("Unknown state codes:", bad.join(", ")); process.exit(1); }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  const rest = `${url.replace(/\/$/, "")}/rest/v1/outreach_campaigns`;
  const headers = { apikey: svc, authorization: `Bearer ${svc}`, "content-type": "application/json" };

  // Existing catholic_school campaigns -> skip those states (idempotent).
  const existingRes = await fetch(`${rest}?select=state_code,message_variant&message_variant=eq.catholic_school`, { headers });
  if (!existingRes.ok) throw new Error(`list existing failed: ${existingRes.status} ${await existingRes.text()}`);
  const existing = new Set((await existingRes.json()).map((r) => r.state_code));

  const created = [], skipped = [];
  for (const code of wanted) {
    if (existing.has(code)) { skipped.push(code); continue; }
    const row = {
      name: `${STATES[code]} Catholic Schools`,
      center_label: STATES[code],
      radius_miles: 25,
      geography_type: "state",
      state_code: code,
      denomination_filter: ["usccb"],
      discount_percent: 10,
      message_variant: "catholic_school",
      discovery_target_count: 25,
      status: "draft",
    };
    if (dry) { created.push(`${code} (dry)`); continue; }
    const res = await fetch(rest, { method: "POST", headers: { ...headers, prefer: "return=representation" }, body: JSON.stringify(row) });
    if (!res.ok) { console.error(`create ${code} failed: ${res.status} ${await res.text()}`); continue; }
    created.push(code);
  }
  console.log(JSON.stringify({ created, skipped, dry }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
