# lengua

Real-time conversation aid: helps a heritage Spanish learner talk with his
grandmother in Dominican Spanish (Santiago/Cibao, formal usted register).

Live transcript + live English translation of grandma → 3 opener suggestions
when she finishes → big **Stuck** button mid-sentence → grammar corrections
after his turn. See `docs/product-brief.md` and the full spec at
`~/workspace/user/files/lengua-spec.md`.

## Quickstart

```bash
cd backend
cp .env.example .env        # then add ANTHROPIC_API_KEY for live LLM calls
npm install
npm run build               # tsc + web bundle (web/dist/app.js)
npm run dev                 # backend + web UI on http://localhost:3000
```

Open `http://localhost:3000`, tap **Grandma** or **Me**. Without an API key
the backend runs in **mock LLM mode** (canned responses, loudly logged) and
the mock STT adapter replays `samples/*.script.jsonl`, so the whole flow is
demoable with no key and no mic.

### CLI (Milestone 1: text-only prototype)

```bash
cd backend
npm run cli -- translate --text "¿Cómo tú 'tá, mi'jo?"
npm run cli -- openers --es "Cuéntame de la escuela." --en "Tell me about school."
npm run cli -- stuck --partial "I want to say congrats on the ..."
npm run cli -- review --text "Yo quiero decirle que estoy bien"
npm run cli -- translate --print-prompts --text "..."   # show prompts, no API call
```

### Tests

```bash
cd backend && npm test
```

## iPad mic over the LAN

iPad Safari only grants `getUserMedia` in a secure context. `localhost` dev is
fine on the laptop, but the iPad at `http://<lan-ip>:3000` will refuse the mic.
Serve the backend over **HTTPS** (self-signed cert the iPad trusts, or a
tunnel like ngrok / Cloudflare Tunnel) before real-conversation testing.

## Repo layout

```
lengua/
├─ README.md
├─ docs/                    # product-brief, architecture, prompts, testing-plan
├─ backend/
│  ├─ src/
│  │  ├─ server.ts          # HTTP + WebSocket, pipeline wiring
│  │  ├─ stt/               # SttProvider interface + MockSttAdapter
│  │  ├─ llm/               # Anthropic client, prompts, JSON parsing, 4 functions
│  │  ├─ session/           # in-memory session store (no audio stored, ever)
│  │  └─ cli.ts             # M1 text-only tester
│  ├─ tests/                # vitest: JSON parsing, mock STT, ws roundtrip
│  ├─ scripts/build-web.mjs # esbuild bundle for the web client
│  └─ .env.example
├─ web/
│  ├─ index.html
│  └─ src/                  # app.ts (UI + WS + mic), worklet.js (PCM16), style.css
└─ samples/                 # mock STT replay scripts (*.script.jsonl)
```

## Status

- [x] Tasks 1–5 (spec §12): scaffold, mock STT, 4 LLM functions + CLI, web UI,
      mic capture + WebSocket audio path
- [ ] Task 6 / M0: **choose a real STT provider** — needs recorded grandma
      samples (accent validation). Mock adapter holds the interface until then.

## Privacy

No audio stored by default. Transcripts in memory; save only via explicit
"Save". "Delete all" wipes the session. Consent reminder on session start.
Key in `backend/.env` (gitignored), never sent to the browser.
