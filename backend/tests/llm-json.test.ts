import { describe, expect, it } from "vitest";
import { LlmParseError, parseJson, stripJsonFences } from "../src/llm/json";

describe("stripJsonFences", () => {
  it("leaves bare JSON alone", () => {
    expect(stripJsonFences(`{"english":"hi"}`)).toBe(`{"english":"hi"}`);
  });
  it("strips ```json fences", () => {
    expect(stripJsonFences('```json\n{"english":"hi"}\n```')).toBe(`{"english":"hi"}`);
  });
  it("strips bare ``` fences", () => {
    expect(stripJsonFences('```\n{"a":1}\n```')).toBe(`{"a":1}`);
  });
  it("tolerates surrounding whitespace", () => {
    expect(stripJsonFences('  \n```json\n{"a": 1}\n```\n  ')).toBe(`{"a": 1}`);
  });
});

describe("parseJson", () => {
  it("parses a fenced translate response", () => {
    expect(parseJson<{ english: string }>('```json\n{"english":"How are you, my boy?"}\n```')).toEqual({
      english: "How are you, my boy?",
    });
  });
  it("parses a fenced openers response", () => {
    const raw =
      '```json\n{"openers":[{"spanish":"Qué bueno, cuénteme más.","english":"That is good, tell me more.","kind":"acknowledge"}]}\n```';
    const out = parseJson<{ openers: Array<{ spanish: string }> }>(raw);
    expect(out.openers[0].spanish).toBe("Qué bueno, cuénteme más.");
  });
  it("throws LlmParseError on malformed JSON", () => {
    expect(() => parseJson('```json\n{"english": oops\n```')).toThrow(LlmParseError);
  });
  it("throws on empty output", () => {
    expect(() => parseJson("")).toThrow(LlmParseError);
  });
  it("rejects prose around the JSON (contract is JSON-only)", () => {
    expect(() => parseJson('Here is the translation:\n{"english":"hi"}')).toThrow(LlmParseError);
  });
  it("keeps the raw output on the error for debugging", () => {
    const raw = "not json at all";
    try {
      parseJson(raw);
      expect.unreachable();
    } catch (e) {
      expect((e as LlmParseError).raw).toBe(raw);
    }
  });
});
