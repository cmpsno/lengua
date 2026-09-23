import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import "dotenv/config";
import { RawData, WebSocket, WebSocketServer } from "ws";
import { MockSttAdapter } from "./stt/mock";
import { SttMode, SttProvider } from "./stt/types";
import { openers, review, stuck, translate, Turn } from "./llm/functions";
import { llmMode } from "./llm/config";
import { Session } from "./session/session";

/**
 * lengua backend: HTTP (serves the web UI) + WebSocket (audio + events).
 *
 * Pipeline per connection:
 *   ws binary frames (16-bit PCM) -> STT adapter -> interim/final/end events
 *   grandma finals -> debounced translate (re-translate growing turn)
 *   grandma finals -> speculative openers (cached, sent on end-of-speech/Done)
 *   "stuck"        -> stuck() -> 3 candidates
 *   "done" (me)    -> review() -> corrections panel
 *
 * Privacy: no audio is stored. Transcripts are in-memory; the user must
 * explicitly POST /api/session/save to persist a JSON file, and can DELETE
 * /api/session at any time ("delete everything").
 */

const PORT = Number(process.env.PORT ?? 3000);
const ROOT = path.resolve(__dirname, "..", ".."); // lengua/
const WEB_DIR = path.join(ROOT, "web");

const SCRIPT_GRANDMA = process.env.LENGUA_SCRIPT_GRANDMA ?? path.join(ROOT, "samples", "grandma.script.jsonl");
const SCRIPT_ME = process.env.LENGUA_SCRIPT_ME ?? path.join(ROOT, "samples", "me.script.jsonl");
const SESSIONS_DIR = path.join(ROOT, "backend", "sessions");

const session = new Session();
let turnCounter = 0;

/* ---------------- STT factory (provider-agnostic) ---------------- */

function createProvider(mode: SttMode): SttProvider {
  // v1: mock adapter replaying a script file. Real providers plug in here
  // after M0 (accent validation), behind the same SttProvider interface.
  const script = mode === "grandma" ? SCRIPT_GRANDMA : SCRIPT_ME;
  return new MockSttAdapter(script);
}

/* ---------------- message helpers ---------------- */

function send(ws: WebSocket, msg: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

/* ---------------- HTTP app ---------------- */

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const url = new URL(req.url ?? "/", "http://x");
  // Explicit, minimal route table (no generic directory serving).
  const routes: Record<string, string> = {
    "/": path.join(WEB_DIR, "index.html"),
    "/app.js": path.join(WEB_DIR, "dist", "app.js"),
    "/worklet.js": path.join(WEB_DIR, "src", "worklet.js"),
    "/style.css": path.join(WEB_DIR, "src", "style.css"),
  };
  const file = routes[url.pathname];
  if (!file) return false;
  if (!fs.existsSync(file)) {
    res.writeHead(404).end("not found (did you run npm run build:web?)");
    return true;
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
  return true;
}

export function createApp(): http.Server {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");

    if (req.method === "GET" && url.pathname === "/api/session") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(session.toJSON()));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/session/save") {
      // Explicit user action only.
      const file = path.join(SESSIONS_DIR, `${session.id}.json`);
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(session.toJSON(), null, 2));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ saved: file }));
      return;
    }
    if (req.method === "DELETE" && url.pathname === "/api/session") {
      session.clear();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ deleted: true }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, llm: llmMode() }));
      return;
    }

    if (serveStatic(req, res)) return;
    res.writeHead(404).end("not found");
  });
  return server;
}

/* ---------------- WebSocket handling ---------------- */

interface ConnState {
  mode: SttMode;
  provider: SttProvider;
  turnId: string;
  turnText: string; // accumulated final segments for the current turn
  turnTranslation: string;
  lastConfidence: number | null;
  translateTimer: NodeJS.Timeout | null;
  translateAbort: AbortController | null;
  pendingOpeners: Promise<{ openers: unknown[] }> | null;
  openersSent: boolean;
}

function newTurnState(): Omit<ConnState, "mode" | "provider"> {
  return {
    turnId: `t${++turnCounter}_${Date.now().toString(36)}`,
    turnText: "",
    turnTranslation: "",
    lastConfidence: null,
    translateTimer: null,
    translateAbort: null,
    pendingOpeners: null,
    openersSent: false,
  };
}

const TRANSLATE_DEBOUNCE_MS = Number(process.env.LENGUA_TRANSLATE_DEBOUNCE_MS ?? 800); // after a segment stabilizes

function attachWebSocket(server: http.Server): void {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws: WebSocket) => {
    let st: ConnState | null = null;

    const scheduleTranslate = () => {
      if (!st || st.mode !== "grandma" || !st.turnText.trim()) return;
      if (st.translateTimer) clearTimeout(st.translateTimer);
      st.translateAbort?.abort();
      st.translateTimer = setTimeout(async () => {
        if (!st) return;
        const text = st.turnText;
        const abort = new AbortController();
        st.translateAbort = abort;
        const t0 = Date.now();
        try {
          const { english } = await translate(text, false, session.turns.slice(-6), { signal: abort.signal });
          if (!st || abort.signal.aborted) return;
          st.turnTranslation = english;
          send(ws, { type: "translation", turnId: st.turnId, english, ms: Date.now() - t0 });
        } catch (e) {
          if ((e as Error).name !== "AbortError") {
            send(ws, { type: "error", where: "translate", message: (e as Error).message });
          }
        }
      }, TRANSLATE_DEBOUNCE_MS);
    };

    /** Speculative openers: recompute on each grandma final segment so the
     *  tray appears almost instantly at end-of-speech (spec §5.3). */
    const refreshSpeculativeOpeners = () => {
      if (!st || st.mode !== "grandma" || st.turnText.trim().length < 8) return;
      const es = st.turnText;
      const en = st.turnTranslation;
      st.pendingOpeners = openers(es, en, session.turns.slice(-6)).catch((e) => {
        send(ws, { type: "error", where: "openers", message: (e as Error).message });
        return { openers: [] as unknown[] };
      }) as Promise<{ openers: unknown[] }>;
    };

    const finishTurn = async (manual: boolean) => {
      if (!st) return;
      const cur = st;
      const text = cur.turnText.trim();
      if (text) {
        const turn: Turn = {
          id: cur.turnId,
          speaker: cur.mode,
          text,
          translation: cur.mode === "grandma" ? cur.turnTranslation || undefined : undefined,
          ts: Date.now(),
        };
        session.addTurn(turn);
        send(ws, { type: "turn", turn });

        if (cur.mode === "grandma") {
          // Send speculative openers if ready, else compute now.
          try {
            const res = cur.pendingOpeners
              ? await cur.pendingOpeners
              : await openers(text, cur.turnTranslation, session.turns.slice(-6));
            if (res.openers.length > 0) {
              send(ws, { type: "openers", turnId: cur.turnId, openers: res.openers });
              cur.openersSent = true;
            }
          } catch (e) {
            send(ws, { type: "error", where: "openers", message: (e as Error).message });
          }
        } else {
          // Me mode: post-turn grammar review (never mid-turn).
          const t0 = Date.now();
          try {
            const res = await review(text, cur.lastConfidence, session.turns.slice(-6));
            send(ws, { type: "review", turnId: cur.turnId, review: res, ms: Date.now() - t0 });
            session.logEvent("review", { turnId: cur.turnId, issues: res.issues.length });
          } catch (e) {
            send(ws, { type: "error", where: "review", message: (e as Error).message });
          }
        }
      }
      // Fresh turn state on the same provider.
      const keep = { mode: cur.mode, provider: cur.provider };
      if (cur.translateTimer) clearTimeout(cur.translateTimer);
      cur.translateAbort?.abort();
      st = { ...newTurnState(), ...keep } as ConnState;
      send(ws, { type: "turn_reset", manual });
    };

    const startMode = (mode: SttMode) => {
      st?.provider.stop();
      const provider = createProvider(mode);
      st = { ...newTurnState(), mode, provider };
      send(ws, { type: "mode", mode, provider: "mock", script: (provider as MockSttAdapter).script });

      provider.onInterim((text) => send(ws, { type: "interim", turnId: st!.turnId, text }));
      provider.onFinal((text, meta) => {
        if (!st) return;
        st.turnText = st.turnText ? `${st.turnText} ${text}` : text;
        st.lastConfidence = meta?.confidence ?? null;
        send(ws, { type: "final", turnId: st.turnId, text: st.turnText });
        if (st.mode === "grandma") {
          scheduleTranslate();
          refreshSpeculativeOpeners();
        }
      });
      provider.onEndOfSpeech(() => {
        send(ws, { type: "end_of_speech", turnId: st!.turnId });
        void finishTurn(false);
      });
      provider.start({ mode, languageHint: mode === "grandma" ? "es-DO" : "es-DO,en-US" });
    };

    ws.on("message", async (data: RawData, isBinary: boolean) => {
      if (isBinary) {
        // 16-bit PCM chunk from the browser; forwarded to the STT adapter.
        const buf = data as Buffer;
        const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
        st?.provider.sendAudio(ab);
        return;
      }
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        send(ws, { type: "error", where: "protocol", message: "invalid JSON" });
        return;
      }

      switch (msg.type) {
        case "start":
          if (msg.mode !== "grandma" && msg.mode !== "me") {
            send(ws, { type: "error", where: "protocol", message: "start needs mode grandma|me" });
            break;
          }
          if (msg.consent === true) session.consentAt = Date.now();
          startMode(msg.mode as SttMode);
          break;
        case "done":
          void finishTurn(true);
          break;
        case "stuck": {
          // Mid-sentence help: partial (may be empty -> use current turn text).
          const partial = (msg.partial as string) || st?.turnText || "";
          const grandmaLast = [...session.turns].reverse().find((t) => t.speaker === "grandma")?.text ?? "";
          const t0 = Date.now();
          try {
            const res = await stuck(partial, grandmaLast, session.turns.slice(-6));
            send(ws, { type: "candidates", candidates: res.candidates, ms: Date.now() - t0 });
            session.logEvent("stuck", { partial: partial.slice(0, 120), candidates: res.candidates.length });
          } catch (e) {
            send(ws, { type: "error", where: "stuck", message: (e as Error).message });
          }
          break;
        }
        case "switch":
          // Stop current provider; UI re-sends "start" with the new mode.
          st?.provider.stop();
          st = null;
          break;
        default:
          send(ws, { type: "error", where: "protocol", message: `unknown message type: ${msg.type}` });
      }
    });

    ws.on("close", () => {
      st?.provider.stop();
      if (st?.translateTimer) clearTimeout(st.translateTimer);
    });
  });
}

/* ---------------- main ---------------- */

if (require.main === module) {
  const server = createApp();
  attachWebSocket(server);
  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`lengua backend on http://localhost:${PORT} (LLM mode: ${llmMode()})`);
    if (llmMode() === "mock") {
      // eslint-disable-next-line no-console
      console.log("mock LLM mode: set ANTHROPIC_API_KEY in backend/.env for live calls");
    }
  });
}

export { attachWebSocket };
