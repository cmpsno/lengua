import { Turn } from "./functions";

/**
 * Shared system context for all live LLM calls (spec §7 preamble), parametrized
 * as config so dialect/register can change in one place.
 */
export const SYSTEM_CONTEXT = `You are a live conversation aid for a heritage Spanish learner speaking with his grandmother.
- Grandmother: older woman from Santiago, Dominican Republic.
- Speak and suggest in natural Dominican Spanish (Cibao region) appropriate for an older woman.
- Register: FORMAL. The user addresses his grandmother as "usted".
- The user is a native English speaker who mixes English and Spanish (Spanglish) and struggles most with starting sentences.
- Keep suggestions SHORT and speakable. Prefer common everyday words over literary ones.
- Respond with JSON only. No preamble, no markdown fences.`;

function historyBlock(history: Turn[]): string {
  if (history.length === 0) return "(no prior turns)";
  return history
    .map((t) => `${t.speaker === "grandma" ? "Grandma" : "Me"}: ${t.text}`)
    .join("\n");
}

export interface BuiltPrompt {
  system: string;
  user: string;
}

export function buildTranslate(spanishSoFar: string, isFinal: boolean, history: Turn[]): BuiltPrompt {
  return {
    system: SYSTEM_CONTEXT,
    user:
      `Translate the grandmother's Spanish into natural English.\n` +
      `Preserve meaning and tone. If the text is incomplete, translate what is there without inventing the ending.\n` +
      `Treat likely transcription errors on Dominican pronunciation leniently (dropped final s, r/l shifts, fast speech) and use context to resolve them.\n` +
      `Respond with JSON only: { "english": "string" }\n\n` +
      `Segment (${isFinal ? "final" : "still growing"}):\n${spanishSoFar}\n\n` +
      `Conversation history:\n${historyBlock(history)}`,
  };
}

export function buildOpeners(grandmaEs: string, grandmaEn: string, history: Turn[]): BuiltPrompt {
  return {
    system: SYSTEM_CONTEXT,
    user:
      `Give exactly 3 short ways the user could START a reply to what his grandmother just said.\n` +
      `Vary the "kind" across the 3. Aim to move the conversation deeper than small talk (family, memories, feelings, stories), not just repeat pleasantries.\n` +
      `Each opener must be 2 to 8 words and end naturally so the user can continue on his own.\n` +
      `Respond with JSON only:\n` +
      `{ "openers": [ { "spanish": "string", "english": "string", "kind": "acknowledge|question_back|transition|share|clarify" } ] }\n\n` +
      `What she just said (Spanish):\n${grandmaEs}\n\n` +
      `What she just said (English):\n${grandmaEn}\n\n` +
      `Conversation history:\n${historyBlock(history)}`,
  };
}

export function buildStuck(partial: string, grandmaLastEs: string, history: Turn[]): BuiltPrompt {
  return {
    system: SYSTEM_CONTEXT,
    user:
      `The user got stuck mid-sentence. The partial may contain English words or "how do you say..." fragments.\n` +
      `Infer the word or phrase he is reaching for and return exactly 3 ranked candidates.\n` +
      `Prefer Dominican-appropriate words. Put a short usage note only when it prevents a mistake (e.g. false friends or regional differences); otherwise null.\n` +
      `Respond with JSON only:\n` +
      `{ "candidates": [ { "spanish": "string", "english": "string", "note": "string|null" } ] }\n\n` +
      `His partial sentence:\n${partial}\n\n` +
      `Her last statement:\n${grandmaLastEs}\n\n` +
      `Conversation history:\n${historyBlock(history)}`,
  };
}

export function buildReview(userTurn: string, transcriptConfidence: number | null, history: Turn[]): BuiltPrompt {
  return {
    system: SYSTEM_CONTEXT,
    user:
      `Correct the user's Spanish: grammar, verb conjugation, gender/number agreement, register (must be formal usted with his grandmother), and unnatural phrasing.\n` +
      `English words he left in should be listed as gaps with the Spanish equivalent.\n` +
      `Do NOT "correct" a span that looks like a speech-recognition mishearing — flag it with possible_transcription_error: true instead.\n` +
      `Keep explanations to one or two plain sentences. Be encouraging, not exhaustive: prioritize the 1 to 3 most valuable fixes.\n` +
      `Respond with JSON only:\n` +
      `{\n` +
      `  "issues": [ { "original": "string", "corrected": "string", "explanation": "string", "severity": "minor|moderate|major", "possible_transcription_error": false } ],\n` +
      `  "natural_version": "string",\n` +
      `  "encouragement": "string|null"\n` +
      `}\n\n` +
      `His turn:\n${userTurn}\n\n` +
      `Transcript confidence: ${transcriptConfidence === null ? "unknown" : transcriptConfidence}\n\n` +
      `Conversation history:\n${historyBlock(history)}`,
  };
}
