import { extractDiscoveryJson } from "./discovery-core";

/**
 * Anthropic discovery provider — the FAILOVER for the OpenAI discovery agent.
 *
 * The primary provider (lib/outreach/discovery.ts) is OpenAI's Responses API with
 * its `web_search` server tool. When OpenAI returns a credit-exhaustion error
 * mid-run, the current lane fails over to THIS module so discovery continues
 * instead of stalling (spec: DiscoveryAgentProviderFailover). It reproduces the
 * same search-and-extract work on Anthropic's Messages API:
 *   - the `web_search_20260209` server tool browses the same diocesan/denominational
 *     sources, and
 *   - the SAME system prompt (which already ends with "Return ONLY a JSON object,
 *     …") makes the model emit the identical leads JSON, parsed with the shared
 *     extractDiscoveryJson.
 *
 * Anthropic has no background/poll mode, so this call is SYNCHRONOUS — the caller
 * runs it inline for the failed-over lane and processes the returned leads in the
 * same invocation. Model defaults to claude-sonnet-5 (chosen 2026-08-20: supports
 * web_search_20260209 + is far cheaper than Opus for a bulk extraction fallback).
 *
 * No `server-only` import (like directory-sources.ts) so the CLI test harness and
 * the server discovery agent can both use it. Only depends on fetch + env.
 */

export const ANTHROPIC_DISCOVERY_MODEL = process.env.OUTREACH_ANTHROPIC_MODEL || "claude-sonnet-5";

// Bound cost: a two-lead lane needs only a few searches, and the JSON payload is
// small. Mirrors the OpenAI side's low search-context / capped output.
const MAX_WEB_SEARCHES = 5;
const MAX_OUTPUT_TOKENS = 8000;
const REQUEST_TIMEOUT_MS = 120_000;

export function anthropicApiKey(): string | null {
  return process.env.ANTHROPIC_API_KEY || null;
}

/** True when Anthropic can be used as a failover target (key present). */
export function anthropicDiscoveryAvailable(): boolean {
  return Boolean(anthropicApiKey());
}

interface AnthropicMessage {
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  stop_reason?: string;
  error?: { type?: string; message?: string } | null;
}

export interface AnthropicDiscoveryResult {
  /** Raw lead objects exactly as the model returned them (pre-policy). The caller
   *  applies the same directory/school lead policies used for the OpenAI output. */
  leads: unknown[];
  usage: { input_tokens?: number; output_tokens?: number };
}

/**
 * Run one synchronous discovery request on Anthropic. Uses the SAME system prompt
 * and user prompt as the OpenAI lane so the output shape and guardrails are
 * identical. Throws on any non-2xx (message includes the body so the caller's
 * credit-exhaustion detector can classify an Anthropic-side dry too — enabling
 * failover in the other direction).
 */
export async function anthropicDiscoverLeads(args: {
  system: string;
  prompt: string;
  timeoutMs?: number;
}): Promise<AnthropicDiscoveryResult> {
  const key = anthropicApiKey();
  if (!key) throw new Error("anthropic_unavailable: ANTHROPIC_API_KEY is not set");

  const body = {
    model: ANTHROPIC_DISCOVERY_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: args.system,
    // Keep the fallback cheap and deterministic: no extended thinking, minimal effort.
    thinking: { type: "disabled" as const },
    output_config: { effort: "low" as const },
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: MAX_WEB_SEARCHES }],
    messages: [{ role: "user" as const, content: args.prompt }],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`anthropic_timeout_${(args.timeoutMs ?? REQUEST_TIMEOUT_MS) / 1000}s`);
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // Include the body so isCreditExhaustedError() can see Anthropic's
    // "credit balance is too low" message and fail over the other way.
    throw new Error(`anthropic_${res.status}: ${(await res.text()).slice(0, 400)}`);
  }

  const data = (await res.json()) as AnthropicMessage;
  const text = (data.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n");
  const parsed = extractDiscoveryJson(text);
  const rawLeads = parsed && Array.isArray(parsed.leads) ? (parsed.leads as unknown[]) : [];
  return { leads: rawLeads, usage: data.usage ?? {} };
}
