import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

/**
 * Headless WebSocket roundtrip: real server + mock STT + mock LLM
 * (no Anthropic key needed). Verifies the full pipeline event sequence
 * and the binary audio path.
 */

function writeScript(lines: string[]): string {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lengua-ws-")), "s.jsonl");
  fs.writeFileSync(f, lines.join("\n"));
  return f;
}

interface Msg {
  type: string;
  [k: string]: unknown;
}

let server: http.Server;
let port: number;
let attach: (s: http.Server) => void;
let createApp: () => http.Server;

beforeAll(async () => {
  const g = writeScript([
    `{"at": 20, "event": "interim", "text": "ay mi'jo"}`,
    `{"at": 40, "event": "final", "text": "Ay mi'jo, ¿cómo tú 'tá?", "confidence": 0.9}`,
    `{"at": 150, "event": "end"}`,
  ]);
  const m = writeScript([
    `{"at": 20, "event": "interim", "text": "I was thinking que"}`,
    `{"at": 40, "event": "final", "text": "I was thinking que maybe I can visit.", "confidence": 0.8}`,
    `{"at": 60000, "event": "end"}`,
  ]);
  process.env.LENGUA_SCRIPT_GRANDMA = g;
  process.env.LENGUA_SCRIPT_ME = m;
  process.env.LENGUA_TRANSLATE_DEBOUNCE_MS = "50";
  process.env.LENGUA_MOCK_LLM = "1";
  delete process.env.ANTHROPIC_API_KEY;

  const srv = await import("../src/server");
  attach = srv.attachWebSocket;
  createApp = srv.createApp;
  server = createApp();
  attach(server);
  await new Promise<void>((res) => server.listen(0, res));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((res) => server.close(() => res()));
});

function connect(): Promise<{ ws: WebSocket; inbox: Msg[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const inbox: Msg[] = [];
    ws.on("message", (d) => inbox.push(JSON.parse(d.toString()) as Msg));
    ws.on("open", () => resolve({ ws, inbox }));
    ws.on("error", reject);
  });
}

async function waitFor(inbox: Msg[], type: string, timeout = 8000): Promise<Msg> {
  const t0 = Date.now();
  for (;;) {
    const found = inbox.find((m) => m.type === type);
    if (found) return found;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${type}; got: ${inbox.map((m) => m.type).join(",")}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

const send = (ws: WebSocket, o: Record<string, unknown>) => ws.send(JSON.stringify(o));

describe("websocket audio roundtrip", () => {
  it("grandma mode: interim -> final -> turn -> translation -> openers", async () => {
    const { ws, inbox } = await connect();
    try {
      send(ws, { type: "start", mode: "grandma", consent: true });
      // Binary audio chunk: accepted by the STT adapter without error.
      ws.send(Buffer.from(new Int16Array(320).fill(100)));

      const interim = await waitFor(inbox, "interim");
      expect(interim.text).toContain("ay mi'jo");

      const fin = await waitFor(inbox, "final");
      expect(fin.text).toContain("¿cómo tú 'tá?");

      const tr = await waitFor(inbox, "translation");
      expect(typeof tr.english).toBe("string");

      const turn = await waitFor(inbox, "turn");
      const t = turn.turn as { speaker: string; text: string };
      expect(t.speaker).toBe("grandma");
      expect(t.text).toContain("¿cómo tú 'tá?");

      const ops = await waitFor(inbox, "openers");
      const openers = ops.openers as Array<{ spanish: string; english: string; kind: string }>;
      expect(openers).toHaveLength(3);
      expect(openers[0].spanish.length).toBeGreaterThan(0);
    } finally {
      ws.close();
    }
  }, 15000);

  it("me mode: stuck returns 3 candidates, done returns a review", async () => {
    const { ws, inbox } = await connect();
    try {
      send(ws, { type: "start", mode: "me" });
      await waitFor(inbox, "final");

      send(ws, { type: "stuck", partial: "I want to say congrats on the" });
      const cands = await waitFor(inbox, "candidates");
      const c = cands.candidates as Array<{ spanish: string; english: string }>;
      expect(c).toHaveLength(3);
      expect(c[0].spanish.length).toBeGreaterThan(0);
      expect(typeof cands.ms).toBe("number");

      send(ws, { type: "done" });
      const rev = await waitFor(inbox, "review");
      const r = rev.review as { issues: unknown[]; natural_version: string };
      expect(Array.isArray(r.issues)).toBe(true);
      expect(typeof r.natural_version).toBe("string");
    } finally {
      ws.close();
    }
  }, 15000);

  it("reports mock LLM mode on /api/health", async () => {
    const body = await new Promise<string>((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve(d));
      }).on("error", reject);
    });
    expect(JSON.parse(body)).toEqual({ ok: true, llm: "mock" });
  });
});
