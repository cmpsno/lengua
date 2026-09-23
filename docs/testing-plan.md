# lengua — testing plan

## Unit tests (`cd backend && npm test`, vitest)

1. **LLM JSON parsing** (`tests/llm-json.test.ts`)
   - bare JSON object parses
   - ```json fenced block parses (fence stripped)
   - plain ``` fence without language tag parses
   - leading/trailing whitespace tolerated
   - malformed JSON throws `LlmParseError`
   - JSON with prose around it is rejected (contract is JSON-only)
2. **Prompt builders** (`tests/llm-prompts.test.ts`)
   - each builder returns `{ system, user }` with the shared system context
   - translate/openers/stuck/review prompts mention their JSON schema
   - formal usted + Dominican/Cibao cues present
3. **Mock STT adapter** (`tests/mock-stt.test.ts`)
   - replays a script file as interim → final → end, in order, with the right text
   - `stop()` cancels pending events (no callbacks after stop)
   - malformed script lines throw a clear error at construction
4. **WebSocket audio roundtrip** (`tests/ws-roundtrip.test.ts`, headless)
   - start server on an ephemeral port with the mock provider
   - client sends `{ type: "start", mode: "grandma" }` + binary audio frames
   - receives interim/final events in script order, then `turn` + `openers`
   - `{ type: "stuck" }` returns 3 candidates (mock LLM mode)
   - `{ type: "done" }` in me mode returns a review payload
   - all green **without** an Anthropic key (mock LLM mode)

## Manual / Milestone tests

- **M1 (text-only):** `npm run cli -- translate --text "…"` etc. for each of the
  four functions, with a real key: check translation quality, opener variety
  and register, stuck relevance, review usefulness. `--print-prompts` shows the
  exact prompts without spending API calls.
- **M2 (mock pipeline):** `npm run dev`, open `http://localhost:3000`,
  toggle Grandma/Me, watch the script replay: interim < 500ms feel, finals,
  translation updates, openers on end, stuck candidates, review panel.
- **Mic check:** same page, tap Grandma, allow mic — confirm the worklet
  streams (status shows mode; interim events would come from a real provider
  later — with the mock, audio is accepted and ignored).
- **Latency spot-checks:** `ms` fields on `translation`/`candidates`/`review`
  messages show server-side LLM time; compare against the §6.3 budgets
  (translation < 1.5s, openers < 1s at end-of-speech, stuck < 1.5s).
- **M0 (accent validation, user's call):** record real grandma samples
  (with consent) into `samples/` (audio extensions are gitignored), run
  candidate STT providers against them, write a short comparison note, then
  choose the default provider per mode (task 6 — not started).

## Regression rules

- A broken build is not a result: `npm run build` (tsc + web bundle) and
  `npm test` must be green before any report of "done".
- New prompt changes get a CLI smoke test before commit.
