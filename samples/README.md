# samples

Mock STT replay scripts for development without a real provider or mic.

- `grandma.script.jsonl` — fake Dominican-grandma turn: interim words build up,
  two `final` segments, then `end` (end-of-speech).
- `me.script.jsonl` — fake user turn with Spanglish ("I was thinking que…").

Format: one JSON object per line:

```json
{"at": 400, "event": "interim", "text": "ay mi'jo"}
{"at": 1300, "event": "final", "text": "Ay mi'jo, ¿cómo tú 'tá?", "confidence": 0.93}
{"at": 2600, "event": "end"}
```

`at` is milliseconds after the provider starts. Point the mock at different
scripts with `LENGUA_SCRIPT_GRANDMA` / `LENGUA_SCRIPT_ME` env vars.

Real recorded audio for M0 accent validation goes here too — `*.wav`,
`*.mp3`, `*.m4a`, etc. are **gitignored** so private recordings never get
committed. Record only with grandma's consent.
