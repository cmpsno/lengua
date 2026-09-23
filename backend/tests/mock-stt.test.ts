import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { MockSttAdapter } from "../src/stt/mock";

function writeScript(lines: string[]): string {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lengua-script-")), "s.jsonl");
  fs.writeFileSync(f, lines.join("\n"));
  return f;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("MockSttAdapter", () => {
  it("replays interim -> final -> end in order", async () => {
    const f = writeScript([
      `{"at": 10, "event": "interim", "text": "ay"}`,
      `{"at": 30, "event": "interim", "text": "ay mi'jo"}`,
      `{"at": 50, "event": "final", "text": "Ay mi'jo.", "confidence": 0.9}`,
      `{"at": 80, "event": "end"}`,
    ]);
    const a = new MockSttAdapter(f);
    const seen: string[] = [];
    a.onInterim((t) => seen.push(`interim:${t}`));
    a.onFinal((t, m) => seen.push(`final:${t}:${m?.confidence}`));
    a.onEndOfSpeech(() => seen.push("end"));
    a.start({ mode: "grandma", languageHint: "es-DO" });
    await sleep(200);
    expect(seen).toEqual(["interim:ay", "interim:ay mi'jo", "final:Ay mi'jo.:0.9", "end"]);
    a.stop();
  });

  it("stop() cancels pending events", async () => {
    const f = writeScript([
      `{"at": 10, "event": "interim", "text": "hola"}`,
      `{"at": 300, "event": "end"}`,
    ]);
    const a = new MockSttAdapter(f);
    const seen: string[] = [];
    a.onInterim((t) => seen.push(t));
    a.onEndOfSpeech(() => seen.push("end"));
    a.start({ mode: "me", languageHint: "es-DO,en-US" });
    await sleep(80);
    a.stop();
    await sleep(400);
    expect(seen).toEqual(["hola"]); // no "end" after stop
  });

  it("sendAudio is accepted and ignored", () => {
    const f = writeScript([`{"at": 50, "event": "end"}`]);
    const a = new MockSttAdapter(f);
    a.start({ mode: "me", languageHint: "es-DO,en-US" });
    expect(() => a.sendAudio(new ArrayBuffer(320))).not.toThrow();
    a.stop();
  });

  it("throws a clear error on malformed script lines", () => {
    const f = writeScript([`{"at": 10, "event": "interim"}`]); // missing text
    expect(() => new MockSttAdapter(f)).toThrow(/needs string "text"/);
  });

  it("throws a clear error on invalid JSON", () => {
    const f = writeScript([`not json`]);
    expect(() => new MockSttAdapter(f)).toThrow(/not valid JSON/);
  });
});
