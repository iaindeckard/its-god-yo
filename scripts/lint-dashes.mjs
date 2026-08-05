#!/usr/bin/env node
/**
 * Dash-policy linter (permanent policy, not a one-time cleanup).
 *
 * Customer-facing communications must never use an em dash (—) or an en dash (–)
 * as a sentence connector. Where a dash is currently doing that work, rewrite the
 * copy: split into two sentences, or use a period or comma. Do NOT swap in a
 * shorter dash (en/hyphen) that reads the same way. That defeats the point.
 *
 * The scanner tokenizes each file with the TypeScript parser and only inspects
 * text that actually reaches a user: string literals, template strings, and JSX
 * text. Comments and code are skipped, so every hit is real rendered/sent copy.
 * Dash detection itself is a simple regex over those token strings.
 *
 * Scope: on-site copy (app, components) and SMS/email templates + shared copy
 * (lib). SMS templates, transactional emails, and marketing/app pages all live
 * under these directories.
 *
 * Usage:
 *   node scripts/lint-dashes.mjs            # enforced customer-facing scope; exit 1 if any hits
 *   node scripts/lint-dashes.mjs --all      # full audit across app + components + lib
 *   node scripts/lint-dashes.mjs --json     # machine-readable output (combine with --all)
 *
 * Allowed: an en dash between two digits (a numeric range, e.g. 2010–2012).
 * Everything else with an em/en dash is reported for human review.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const JSON_OUT = process.argv.includes("--json");
// --all scans every source file (app + components + lib) for a full audit.
// Default (and the enforced/CI scope) is customer-facing copy only.
const SCAN_ALL = process.argv.includes("--all");

const SCAN_DIRS = ["app", "components", "lib"];
const EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

// The enforced customer-facing scope: on-site copy (all of app/ except the
// internal admin UI) + shared components + SMS/email template libs + shared UI
// copy (lib/i18n.ts). Admin is internal. app/api route handlers ARE in scope
// (their error messages + rendered responses reach users), EXCEPT a small set of
// internal-only routes (cron jobs + the Stripe webhook) whose only em dashes live
// in server logs / ops-alert emails, never in customer output. Expand
// ENFORCED_LIB_FILES / prune INTERNAL_ONLY as more copy is cleaned.
const ENFORCED_LIB_FILES = new Set([
  "lib/preorder/messages.ts", "lib/preorder/notify.ts", "lib/preorder/launch.ts", "lib/preorder/removal.ts",
  "lib/twilio.ts", "lib/twilioInbound.ts", "lib/dailySend.ts", "lib/dmAddon.ts", "lib/bounty.ts",
  "lib/cornerstoneEmails.ts", "lib/bountyEmails.ts", "lib/outreach/email.ts", "lib/sponsorInquiry.ts",
  "lib/i18n.ts",
]);
// Internal-only API routes: their strings are console logs and ops-alert emails
// to staff, not customer-facing output, so they're exempt from the dash policy.
const INTERNAL_ONLY = new Set([
  "app/api/cron/reconcile-payments/route.ts",
  "app/api/cron/season-content-alarm/route.ts",
  "app/api/stripe/webhook/route.ts",
]);
function customerFacing(rel) {
  if (rel.startsWith("app/admin/")) return false;
  if (INTERNAL_ONLY.has(rel)) return false;
  if (rel.startsWith("app/") || rel.startsWith("components/")) return true;
  return ENFORCED_LIB_FILES.has(rel);
}

function skip(p) {
  const rel = relative(ROOT, p);
  if (
    rel.includes("node_modules") ||
    rel.includes("__tests__") ||
    rel.startsWith("scripts/") ||          // tooling / fixtures, not customer-facing
    rel.endsWith(".d.ts")
  ) return true;
  if (!SCAN_ALL && !customerFacing(rel)) return true;
  return false;
}

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      if (name !== "node_modules") walk(p, out);
    } else if (EXTS.has(extname(p)) && !skip(p)) {
      out.push(p);
    }
  }
  return out;
}

const EM = "—"; // —
const EN = "–"; // –

// Find dash occurrences inside one text token. `abs(i)` maps a local index to an
// absolute source offset. Returns [{ offset, kind }].
function findDashes(text, abs) {
  const hits = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === EM) {
      hits.push({ offset: abs(i), kind: "em-dash" });
    } else if (ch === EN) {
      const prev = text[i - 1] || "";
      const next = text[i + 1] || "";
      // Allow a bare numeric range (2010–2012, $5–10). Flag everything else,
      // including any spaced en dash, which is the classic connector form.
      if (!(/\d/.test(prev) && /\d/.test(next))) {
        hits.push({ offset: abs(i), kind: "en-dash-connector" });
      }
    }
  }
  // HTML-entity forms that render as em/en dashes in JSX / string copy.
  for (const m of text.matchAll(/&mdash;|&#8212;|&#x2014;/gi)) {
    hits.push({ offset: abs(m.index), kind: "em-dash (entity)" });
  }
  for (const m of text.matchAll(/&ndash;|&#8211;|&#x2013;/gi)) {
    hits.push({ offset: abs(m.index), kind: "en-dash-connector (entity)" });
  }
  return hits;
}

// Node kinds whose text is customer-facing.
function isTextCarrier(node) {
  const k = node.kind;
  return (
    k === ts.SyntaxKind.StringLiteral ||
    k === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
    k === ts.SyntaxKind.TemplateHead ||
    k === ts.SyntaxKind.TemplateMiddle ||
    k === ts.SyntaxKind.TemplateTail ||
    k === ts.SyntaxKind.JsxText
  );
}

function scanFile(file, src) {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out = [];
  const visit = (node) => {
    if (isTextCarrier(node)) {
      const start = node.getStart(sf);
      const text = src.slice(start, node.getEnd());
      for (const h of findDashes(text, (i) => start + i)) {
        const { line, character } = sf.getLineAndCharacterOfPosition(h.offset);
        out.push({ line: line + 1, col: character + 1, kind: h.kind });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function snippet(rawLine, col) {
  const start = Math.max(0, col - 31);
  const end = Math.min(rawLine.length, col + 30);
  return (start > 0 ? "…" : "") + rawLine.slice(start, end).trim() + (end < rawLine.length ? "…" : "");
}

const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));
const findings = [];
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const rawLines = src.split("\n");
  for (const h of scanFile(file, src)) {
    findings.push({
      file: relative(ROOT, file),
      line: h.line,
      col: h.col,
      kind: h.kind,
      snippet: snippet(rawLines[h.line - 1] ?? "", h.col),
    });
  }
}
findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.col - b.col);

if (JSON_OUT) {
  console.log(JSON.stringify({ count: findings.length, findings }, null, 2));
  process.exit(findings.length ? 1 : 0);
}

if (findings.length === 0) {
  console.log("✓ dash policy: no em dashes or connector en dashes in customer-facing text.");
  process.exit(0);
}

const byFile = new Map();
for (const f of findings) {
  if (!byFile.has(f.file)) byFile.set(f.file, []);
  byFile.get(f.file).push(f);
}
const counts = findings.reduce((acc, f) => ((acc[f.kind] = (acc[f.kind] || 0) + 1), acc), {});

console.log(`\nDash-policy findings in customer-facing text: ${findings.length} across ${byFile.size} file(s)\n`);
for (const [kind, n] of Object.entries(counts)) console.log(`  ${String(n).padStart(4)}  ${kind}`);
console.log("");
for (const [file, list] of byFile) {
  console.log(`\n${file}  (${list.length})`);
  for (const f of list) console.log(`  ${f.line}:${f.col}  [${f.kind}]  ${f.snippet}`);
}
console.log(
  `\nPolicy: rewrite each as two sentences, or use a period/comma. ` +
  `Do not substitute a shorter dash. Numeric ranges (2010–2012) are allowed.\n`
);
process.exit(1);
