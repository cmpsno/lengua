/**
 * Provider-agnostic streaming speech-to-text interface (spec §6.1).
 *
 * Real providers (Deepgram / AssemblyAI / browser-native / etc.) are wired
 * behind this later. Nothing else in the codebase may depend on a concrete
 * provider — only on this interface plus the event callbacks.
 */
export type SttMode = "grandma" | "me";

export interface SttProvider {
  /** Begin a streaming session. languageHint e.g. "es-DO" or "es-DO,en-US". */
  start(opts: { mode: SttMode; languageHint: string }): void;

  /** Feed one chunk of 16-bit PCM mono audio (16 kHz). */
  sendAudio(chunk: ArrayBuffer): void;

  /** Fired as words stabilize mid-utterance (fast, may change). */
  onInterim(cb: (text: string) => void): void;

  /** Fired when a segment is finalized. */
  onFinal(cb: (text: string, meta?: { confidence?: number }) => void): void;

  /** Fired on end-of-speech (provider VAD or silence timeout). */
  onEndOfSpeech(cb: () => void): void;

  /** Stop the session and release resources. */
  stop(): void;
}
