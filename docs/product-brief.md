# lengua — product brief

**What:** A real-time conversation aid for a heritage Spanish learner talking with his grandmother.

**Who:** One user, personal use, no accounts. The grandmother is an older woman from Santiago, Dominican Republic (Cibao region).

**The problem:** The user understands some Dominican Spanish but struggles to *start* replies in Spanish — conversations stall at "I'm good, school is good." Once he begins, he can flow.

**The bet:** The hardest moment is starting a reply. A tool that (1) shows a live transcript + live English translation of grandma, (2) suggests 3 short, formal, Dominican-appropriate ways to *open* a reply when she finishes, (3) offers a big "Stuck" button mid-sentence for the exact word he's reaching for, and (4) gives grammar corrections *after* his turn — that tool gets conversations past small talk.

## Core loop

1. Tap **Grandma** → live Spanish transcript + live English translation as she speaks.
2. She finishes (pause or **Done**) → 3 opener suggestions (Spanish + English gloss), computed speculatively so they appear instantly.
3. Tap **Me** → live transcript of his Spanglish; **Stuck** anytime → 3 candidate words/phrases.
4. Tap **Done** → review card with corrections, after the turn, never during.

## Language rules (binding)

- Dialect: Dominican Spanish, Cibao/Santiago — natural for an older Dominican woman, not textbook.
- Register: **formal usted** when addressing grandma.
- Input: Spanglish tolerated mid-sentence in transcription and prompts.
- Corrections: wanted, but only after the turn.

## Non-goals (v1)

- Vocabulary log / spaced repetition, automatic hesitation detection, hands-free triggers, other users, accounts, billing, offline mode.

## Success criteria

- Suggestions visible within ~1.5s of a tap or end-of-speech.
- The needed word/opener is in the top 3 often enough to keep a conversation going (target: 70% of Stuck presses).
- Conversation depth improves beyond "how are you / school is good" (user rates depth 1–5 after real conversations).
- Corrections feel useful, not overwhelming.

## Privacy (binding)

- Grandma's consent before each session (in-app reminder).
- No audio stored by default. Transcripts in memory; save only on explicit user action; "delete everything" control exists.
- All secrets in backend env vars. `.env` gitignored. Key never reaches the browser.
