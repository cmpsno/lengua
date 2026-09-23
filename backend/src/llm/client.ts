import { BuiltPrompt } from "./prompts";
import { anthropicApiKey } from "./config";

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

interface AnthropicResponse {
  content: Array<{ type: string; text?: string }>;
}

/**
 * Minimal Anthropic Messages API client (no SDK dependency).
 * Key comes from ANTHROPIC_API_KEY env only.
 */
export async function callAnthropic(
  prompt: BuiltPrompt,
  opts: { model: string; maxTokens: number; timeoutMs: number; signal?: AbortSignal },
): Promise<string> {
  const key = anthropicApiKey();
  if (!key) throw new LlmError("ANTHROPIC_API_KEY is not set");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onAbort);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.maxTokens,
        system: prompt.system,
        messages: [{ role: "user", content: prompt.user }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new LlmError(`Anthropic API error ${res.status}: ${body.slice(0, 300)}`, res.status);
    }
    const data = (await res.json()) as AnthropicResponse;
    const text = data.content
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text as string)
      .join("");
    if (!text) throw new LlmError("Anthropic API returned no text content");
    return text;
  } catch (e) {
    if (e instanceof LlmError) throw e;
    if ((e as Error).name === "AbortError") throw new LlmError("Anthropic request timed out");
    throw new LlmError(`Anthropic request failed: ${(e as Error).message}`);
  } finally {
    clearTimeout(timeout);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}
