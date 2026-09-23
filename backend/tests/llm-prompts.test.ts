import { describe, expect, it } from "vitest";
import {
  buildOpeners,
  buildReview,
  buildStuck,
  buildTranslate,
  SYSTEM_CONTEXT,
} from "../src/llm/prompts";

describe("prompt builders", () => {
  it("all share the system context", () => {
    for (const p of [
      buildTranslate("hola", true, []),
      buildOpeners("hola", "hi", []),
      buildStuck("I want to", "", []),
      buildReview("yo quiero", null, []),
    ]) {
      expect(p.system).toBe(SYSTEM_CONTEXT);
    }
  });

  it("system context pins usted register and Dominican Cibao dialect", () => {
    expect(SYSTEM_CONTEXT).toContain("usted");
    expect(SYSTEM_CONTEXT).toMatch(/Dominican/i);
    expect(SYSTEM_CONTEXT).toContain("JSON only");
  });

  it("translate names its JSON schema", () => {
    const p = buildTranslate("¿cómo tú 'tá?", false, []);
    expect(p.user).toContain('"english"');
  });

  it("openers names its schema and kinds", () => {
    const p = buildOpeners("Cuéntame de la escuela.", "Tell me about school.", []);
    expect(p.user).toContain('"openers"');
    expect(p.user).toContain("acknowledge");
    expect(p.user).toContain("question_back");
  });

  it("stuck names its schema", () => {
    const p = buildStuck("I want to say congrats on the", "", []);
    expect(p.user).toContain('"candidates"');
  });

  it("review names its schema and the transcription-error rule", () => {
    const p = buildReview("yo quiero decirle", 0.8, []);
    expect(p.user).toContain('"issues"');
    expect(p.user).toContain("possible_transcription_error");
    expect(p.user).toContain("mishearing");
  });

  it("history is included when provided", () => {
    const p = buildTranslate("bien", true, [
      { id: "t1", speaker: "grandma", text: "¿cómo estás?", ts: 1 },
    ]);
    expect(p.user).toContain("¿cómo estás?");
  });
});
