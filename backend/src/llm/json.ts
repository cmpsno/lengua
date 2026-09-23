/**
 * Defensive JSON parsing for LLM responses (spec §6.2: "JSON only ...
 * strip code fences defensively before parsing").
 */

export class LlmParseError extends Error {
  constructor(
    message: string,
    public readonly raw: string,
  ) {
    super(message);
    this.name = "LlmParseError";
  }
}

/**
 * Remove ```json / ``` fences and surrounding whitespace.
 * Handles: bare JSON, fenced blocks, fences with language tag, stray prose
 * lines are NOT tolerated — if the core isn't JSON after fence-stripping,
 * we throw so the caller can retry or surface an error.
 */
export function stripJsonFences(raw: string): string {
  let s = raw.trim();
  // Match a fenced block anywhere: ```json ... ``` or ``` ... ```
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1].trim();
  // If still wrapped in a bare fence opener/closer, trim those too.
  s = s.replace(/^```[a-zA-Z]*\s*/, "").replace(/\s*```$/, "").trim();
  return s;
}

export function parseJson<T>(raw: string): T {
  const stripped = stripJsonFences(raw);
  try {
    return JSON.parse(stripped) as T;
  } catch (e) {
    throw new LlmParseError(
      `LLM response was not valid JSON: ${(e as Error).message}`,
      raw,
    );
  }
}
