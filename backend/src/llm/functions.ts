import { callAnthropic, LlmError } from "./client";
import { parseJson } from "./json";
import { buildOpeners, buildReview, buildStuck, buildTranslate } from "./prompts";
import {
  LIVE_MAX_TOKENS,
  LIVE_MODEL,
  LIVE_TIMEOUT_MS,
  llmMode,
  REVIEW_MAX_TOKENS,
  REVIEW_MODEL,
  REVIEW_TIMEOUT_MS,
} from "./config";

/** Shared turn type (spec §7.5). */
export interface Turn {
  id: string;
  speaker: "grandma" | "me";
  text: string;
  translation?: string;
  ts: number;
}

export type OpenerKind = "acknowledge" | "question_back" | "transition" | "share" | "clarify";
export interface Opener {
  spanish: string;
  english: string;
  kind: OpenerKind;
}
export interface StuckCandidate {
  spanish: string;
  english: string;
  note: string | null;
}
export type Severity = "minor" | "moderate" | "major";
export interface ReviewIssue {
  original: string;
  corrected: string;
  explanation: string;
  severity: Severity;
  possible_transcription_error: boolean;
}
export interface ReviewResult {
  issues: ReviewIssue[];
  natural_version: string;
  encouragement: string | null;
}

/* ---------------- shape validation ---------------- */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function str(v: unknown): v is string {
  return typeof v === "string";
}

function validateTranslate(v: unknown): { english: string } {
  if (!isRecord(v) || !str(v.english)) throw new LlmError("translate: expected { english: string }");
  return { english: v.english };
}

const OPENER_KINDS: OpenerKind[] = ["acknowledge", "question_back", "transition", "share", "clarify"];
function validateOpeners(v: unknown): { openers: Opener[] } {
  if (!isRecord(v) || !Array.isArray(v.openers)) throw new LlmError("openers: expected { openers: [...] }");
  const openers: Opener[] = [];
  for (const o of v.openers) {
    if (!isRecord(o) || !str(o.spanish) || !str(o.english)) continue;
    const kind = OPENER_KINDS.includes(o.kind as OpenerKind) ? (o.kind as OpenerKind) : "transition";
    openers.push({ spanish: o.spanish, english: o.english, kind });
    if (openers.length === 3) break;
  }
  if (openers.length === 0) throw new LlmError("openers: model returned no usable openers");
  return { openers };
}

function validateStuck(v: unknown): { candidates: StuckCandidate[] } {
  if (!isRecord(v) || !Array.isArray(v.candidates)) throw new LlmError("stuck: expected { candidates: [...] }");
  const candidates: StuckCandidate[] = [];
  for (const c of v.candidates) {
    if (!isRecord(c) || !str(c.spanish) || !str(c.english)) continue;
    candidates.push({ spanish: c.spanish, english: c.english, note: str(c.note) ? c.note : null });
    if (candidates.length === 3) break;
  }
  if (candidates.length === 0) throw new LlmError("stuck: model returned no usable candidates");
  return { candidates };
}

const SEVERITIES: Severity[] = ["minor", "moderate", "major"];
function validateReview(v: unknown): ReviewResult {
  if (!isRecord(v) || !Array.isArray(v.issues) || !str(v.natural_version)) {
    throw new LlmError("review: expected { issues: [...], natural_version: string, ... }");
  }
  const issues: ReviewIssue[] = [];
  for (const i of v.issues) {
    if (!isRecord(i) || !str(i.original) || !str(i.corrected) || !str(i.explanation)) continue;
    const severity = SEVERITIES.includes(i.severity as Severity) ? (i.severity as Severity) : "minor";
    issues.push({
      original: i.original,
      corrected: i.corrected,
      explanation: i.explanation,
      severity,
      possible_transcription_error: i.possible_transcription_error === true,
    });
  }
  return {
    issues,
    natural_version: v.natural_version,
    encouragement: str(v.encouragement) ? v.encouragement : null,
  };
}

/* ---------------- mock mode (no API key) ---------------- */

const MOCK_OPENERS: Opener[] = [
  { spanish: "Qué bueno, cuénteme más.", english: "That's good — tell me more.", kind: "acknowledge" },
  { spanish: "¿Y eso cómo la hizo sentir?", english: "And how did that make you feel?", kind: "question_back" },
  { spanish: "Eso me acuerda de algo…", english: "That reminds me of something…", kind: "transition" },
];
const MOCK_CANDIDATES: StuckCandidate[] = [
  { spanish: "la boda", english: "the wedding", note: null },
  { spanish: "el bautizo", english: "the baptism", note: null },
  { spanish: "la fiesta de cumpleaños", english: "the birthday party", note: null },
];

/* ---------------- the four functions (spec §7) ---------------- */

export async function translate(
  spanishSoFar: string,
  isFinal: boolean,
  history: Turn[],
  opts?: { signal?: AbortSignal },
): Promise<{ english: string }> {
  if (llmMode() === "mock") return { english: `[mock translation of: ${spanishSoFar.slice(0, 60)}]` };
  const raw = await callAnthropic(buildTranslate(spanishSoFar, isFinal, history), {
    model: LIVE_MODEL,
    maxTokens: LIVE_MAX_TOKENS,
    timeoutMs: LIVE_TIMEOUT_MS,
    signal: opts?.signal,
  });
  return validateTranslate(parseJson(raw));
}

export async function openers(
  grandmaEs: string,
  grandmaEn: string,
  history: Turn[],
): Promise<{ openers: Opener[] }> {
  if (llmMode() === "mock") return { openers: MOCK_OPENERS };
  const raw = await callAnthropic(buildOpeners(grandmaEs, grandmaEn, history), {
    model: LIVE_MODEL,
    maxTokens: LIVE_MAX_TOKENS,
    timeoutMs: LIVE_TIMEOUT_MS,
  });
  return validateOpeners(parseJson(raw));
}

export async function stuck(
  partial: string,
  grandmaLastEs: string,
  history: Turn[],
): Promise<{ candidates: StuckCandidate[] }> {
  if (llmMode() === "mock") return { candidates: MOCK_CANDIDATES };
  const raw = await callAnthropic(buildStuck(partial, grandmaLastEs, history), {
    model: LIVE_MODEL,
    maxTokens: LIVE_MAX_TOKENS,
    timeoutMs: LIVE_TIMEOUT_MS,
  });
  return validateStuck(parseJson(raw));
}

export async function review(
  userTurn: string,
  transcriptConfidence: number | null,
  history: Turn[],
): Promise<ReviewResult> {
  if (llmMode() === "mock") {
    return {
      issues: [
        {
          original: userTurn.slice(0, 40),
          corrected: "[mock corrected version]",
          explanation: "Mock mode: no real review. Set ANTHROPIC_API_KEY for real corrections.",
          severity: "minor",
          possible_transcription_error: false,
        },
      ],
      natural_version: "[mock natural version]",
      encouragement: "Mock mode — keep going!",
    };
  }
  const raw = await callAnthropic(buildReview(userTurn, transcriptConfidence, history), {
    model: REVIEW_MODEL,
    maxTokens: REVIEW_MAX_TOKENS,
    timeoutMs: REVIEW_TIMEOUT_MS,
  });
  return validateReview(parseJson(raw));
}
