# lengua — architecture

## Components

```
iPad Safari (web app)
  ├─ mic capture: getUserMedia → AudioContext → AudioWorklet (pcm16 @ 16 kHz)
  ├─ WebSocket → backend  (JSON control msgs + binary Int16 PCM frames)
  └─ UI: conversation view, suggestion tray, mode bar, review panel

Backend (Node/TypeScript, one process)
  ├─ HTTP: serves the web UI, /api/session (GET/SAVE/DELETE), /api/health
  ├─ WebSocket /ws: per-connection STT session
  ├─ stt/: SttProvider interface + MockSttAdapter (replays *.script.jsonl)
  ├─ llm/: Anthropic client, prompts, JSON parsing/validation
  └─ session/: in-memory Session (turns + timestamped event log)
```

## WebSocket protocol

Client → server:
- `{ type: "start", mode: "grandma"|"me", consent?: boolean }` — begin STT session
- binary `ArrayBuffer` — one chunk of 16-bit PCM mono audio
- `{ type: "done" }` — manual end of turn (grandma: openers; me: review)
- `{ type: "stuck", partial: string }` — mid-sentence help request
- `{ type: "switch" }` — stop current STT session (mode change / session end)

Server → client:
- `{ type: "mode", mode, provider, script }`
- `{ type: "interim", turnId, text }` / `{ type: "final", turnId, text }`
- `{ type: "translation", turnId, english, ms }`
- `{ type: "end_of_speech", turnId }`
- `{ type: "turn", turn }` — finalized turn (spec §7.5 shape)
- `{ type: "turn_reset", manual }`
- `{ type: "openers", turnId, openers }` — after grandma's turn
- `{ type: "candidates", candidates, ms }` — after Stuck
- `{ type: "review", turnId, review, ms }` — after user's turn
- `{ type: "error", where, message }`

## Data flow, per turn

**Grandma mode:** audio → STT interim (shown immediately, <500ms target) → STT final
segments accumulate → debounced (800ms) re-translate of the growing turn
(cancels in-flight call on newer text) → end-of-speech / Done → speculative
openers (recomputed on each final segment, so usually cached and instant) →
turn finalized, corrections never shown for grandma.

**Me mode:** audio → STT interim/final (code-switch-tolerant provider later) →
Stuck button any time → `stuck(partial, last ~6 turns)` → 3 candidates (<1.5s
target) → Done → `review(turn, confidence, last ~6 turns)` → review panel.

## Latency design (spec §6.3)

- Interim on screen: provider event → ws → DOM, no LLM in the path.
- Translation: only on stabilized segments, debounced, previous request aborted.
- Openers: speculative — started during her final segments, awaited at
  end-of-speech. Speculative calls are fire-and-forget with error capture.
- Stuck/review: single LLM call each; review uses the stronger model, no
  latency budget beyond "a few seconds".

## STT provider boundary

`src/stt/types.ts` defines `SttProvider`. `server.ts` builds providers via
`createProvider(mode)` — today that returns `MockSttAdapter`; after M0
(accent validation on real grandma samples) a real provider is chosen per mode
and plugged in there. Nothing else in the codebase knows about providers.

## LLM boundary

`src/llm/functions.ts` exposes `translate / openers / stuck / review`.
All share the system context in `prompts.ts`, parse via `json.ts`
(fence-stripping, shape validation), and read the key from
`ANTHROPIC_API_KEY` only. Without a key they run in **mock mode** with
deterministic canned responses (loudly logged) so the UI flow is demoable.
Live calls: `claude-haiku-4-5`; review: `claude-sonnet-5` (verified against
Anthropic docs 2026-09-23; overridable via env).

## Session store

One in-memory `Session` per backend process: turns + a timestamped log of
`stuck`/`review`/`turn` events (feeds the future vocabulary feature, spec
§5.7). `POST /api/session/save` writes JSON to `backend/sessions/` (explicit
user action); `DELETE /api/session` wipes everything. No audio is ever
written to disk.

## Deployment note (iPad Safari mic)

iPad Safari's `getUserMedia` requires a secure context. `localhost` is fine
for dev on the laptop; the iPad over the LAN is **not** a secure context, so
mic access will be refused unless the backend is served over **HTTPS**
(self-signed cert the iPad trusts, or a tunnel like ngrok/Cloudflare Tunnel).
This is a platform requirement, not a bug in the app — see README quickstart.
