import * as fs from "node:fs";
import { SttMode, SttProvider } from "./types";

/**
 * Mock STT adapter: replays a script file as fake interim/final/end-of-speech
 * events. Lets the whole pipeline (UI, LLM, latency) be exercised without any
 * real provider or microphone.
 *
 * Script format: JSONL, one event per line:
 *   { "at": 400,  "event": "interim", "text": "ay mi'jo" }
 *   { "at": 1600, "event": "final",   "text": "ay mi'jo, ¿cómo tú 'tá?", "confidence": 0.92 }
 *   { "at": 2600, "event": "end" }
 *
 * `at` is milliseconds after start(). Audio chunks are accepted but ignored.
 */
type ScriptEvent =
  | { at: number; event: "interim"; text: string }
  | { at: number; event: "final"; text: string; confidence?: number }
  | { at: number; event: "end" };

function parseScript(path: string): ScriptEvent[] {
  const raw = fs.readFileSync(path, "utf8");
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l, i) => {
      let obj: unknown;
      try {
        obj = JSON.parse(l);
      } catch {
        throw new Error(`mock STT script ${path}: line ${i + 1} is not valid JSON`);
      }
      const e = obj as Record<string, unknown>;
      if (typeof e.at !== "number" || typeof e.event !== "string") {
        throw new Error(`mock STT script ${path}: line ${i + 1} needs numeric "at" and string "event"`);
      }
      if ((e.event === "interim" || e.event === "final") && typeof e.text !== "string") {
        throw new Error(`mock STT script ${path}: line ${i + 1} "${e.event}" needs string "text"`);
      }
      return obj as ScriptEvent;
    })
    .sort((a, b) => a.at - b.at);
}

export class MockSttAdapter implements SttProvider {
  private events: ScriptEvent[];
  private timers: NodeJS.Timeout[] = [];
  private interimCbs: Array<(t: string) => void> = [];
  private finalCbs: Array<(t: string, m?: { confidence?: number }) => void> = [];
  private eosCbs: Array<() => void> = [];
  private started = false;

  constructor(private scriptPath: string) {
    this.events = parseScript(scriptPath);
  }

  get script(): string {
    return this.scriptPath;
  }

  start(_opts: { mode: SttMode; languageHint: string }): void {
    if (this.started) this.stop();
    this.started = true;
    const t0 = Date.now();
    for (const e of this.events) {
      const delay = Math.max(0, e.at - (Date.now() - t0));
      this.timers.push(
        setTimeout(() => {
          if (!this.started) return;
          if (e.event === "interim") this.interimCbs.forEach((cb) => cb(e.text));
          else if (e.event === "final") this.finalCbs.forEach((cb) => cb(e.text, { confidence: e.confidence }));
          else this.eosCbs.forEach((cb) => cb());
        }, delay),
      );
    }
  }

  sendAudio(_chunk: ArrayBuffer): void {
    // Mock ignores audio; the script drives the event timeline.
  }

  onInterim(cb: (text: string) => void): void {
    this.interimCbs.push(cb);
  }
  onFinal(cb: (text: string, meta?: { confidence?: number }) => void): void {
    this.finalCbs.push(cb);
  }
  onEndOfSpeech(cb: () => void): void {
    this.eosCbs.push(cb);
  }

  stop(): void {
    this.started = false;
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }
}
