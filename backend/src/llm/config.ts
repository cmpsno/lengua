/**
 * Model configuration (spec §6.2).
 *
 * Model identifiers verified against Anthropic's docs on 2026-09-23:
 *  - live calls  -> "claude-haiku-4-5"  (alias for claude-haiku-4-5-20251001;
 *    the spec's pinned name is still valid, the alias tracks the latest
 *    Haiku 4.5 snapshot)
 *  - review     -> "claude-sonnet-5"    (current Sonnet tier; spec's name was
 *    current and remains current)
 *
 * Override with LENGUA_LIVE_MODEL / LENGUA_REVIEW_MODEL env vars.
 */

export const LIVE_MODEL = process.env.LENGUA_LIVE_MODEL ?? "claude-haiku-4-5";
export const REVIEW_MODEL = process.env.LENGUA_REVIEW_MODEL ?? "claude-sonnet-5";

export const LIVE_MAX_TOKENS = 300; // live calls are short JSON
export const REVIEW_MAX_TOKENS = 800;

export const LIVE_TIMEOUT_MS = 20_000;
export const REVIEW_TIMEOUT_MS = 45_000;

/** The Anthropic key lives in the backend env only — never sent to the browser. */
export function anthropicApiKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY || undefined;
}

/**
 * "mock" when no key is set (or LENGUA_MOCK_LLM=1): the LLM functions return
 * deterministic canned responses so the whole flow is demoable without a key.
 */
export function llmMode(): "live" | "mock" {
  if (process.env.LENGUA_MOCK_LLM === "1") return "mock";
  return anthropicApiKey() ? "live" : "mock";
}
