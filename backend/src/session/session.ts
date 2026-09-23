import { Turn } from "../llm/functions";

/**
 * In-memory session store (spec §5.6, §5.7).
 *
 * - No audio is stored, ever.
 * - Transcripts live in memory for the session; an explicit "save" writes a
 *   JSON file; "delete" wipes everything.
 * - Stuck events and corrections are logged with timestamps from day one
 *   (future vocabulary-log feature will read from these).
 */
export interface LogEvent {
  ts: number;
  kind: "stuck" | "review" | "turn" | "note";
  detail: Record<string, unknown>;
}

export class Session {
  readonly id: string;
  turns: Turn[] = [];
  log: LogEvent[] = [];
  consentAt: number | null = null;
  startedAt: number = Date.now();

  constructor(id?: string) {
    this.id = id ?? `s${Date.now().toString(36)}`;
  }

  addTurn(turn: Turn): void {
    this.turns.push(turn);
    this.log.push({ ts: Date.now(), kind: "turn", detail: { turnId: turn.id, speaker: turn.speaker } });
  }

  logEvent(kind: LogEvent["kind"], detail: Record<string, unknown>): void {
    this.log.push({ ts: Date.now(), kind, detail });
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      startedAt: this.startedAt,
      consentAt: this.consentAt,
      turns: this.turns,
      log: this.log,
    };
  }

  clear(): void {
    this.turns = [];
    this.log = [];
    this.consentAt = null;
    this.startedAt = Date.now();
  }
}
