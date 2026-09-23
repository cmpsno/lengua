#!/usr/bin/env tsx
/**
 * lengua CLI — Milestone 1: text-only prototype of the four LLM functions.
 *
 *   npm run cli -- translate --text "¿Cómo tú 'tá, mi'jo?"
 *   npm run cli -- openers --es "..." --en "..."
 *   npm run cli -- stuck --partial "I want to say congrats on the ..."
 *   npm run cli -- review --text "Yo quiero decirle que estoy bien"
 *
 * Flags:
 *   --mock           force mock responses (no API call)
 *   --print-prompts  print the exact system+user prompts and exit (no API call)
 *   --history FILE   JSON file with Turn[] for context (optional)
 *
 * Requires ANTHROPIC_API_KEY in the backend env for live calls.
 */
import * as fs from "node:fs";
import "dotenv/config";
import { llmMode } from "./llm/config";
import { openers, review, stuck, translate, Turn } from "./llm/functions";
import { buildOpeners, buildReview, buildStuck, buildTranslate } from "./llm/prompts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(name);
}

function loadHistory(): Turn[] {
  const f = arg("--history");
  if (!f) return [];
  return JSON.parse(fs.readFileSync(f, "utf8")) as Turn[];
}

function need(name: string): string {
  const v = arg(name);
  if (!v) {
    console.error(`missing required ${name}`);
    process.exit(2);
  }
  return v;
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  const history = loadHistory();

  if (flag("--print-prompts")) {
    const text = arg("--text") ?? arg("--partial") ?? arg("--es") ?? "";
    const prompts = {
      translate: buildTranslate(text, true, history),
      openers: buildOpeners(arg("--es") ?? text, arg("--en") ?? "", history),
      stuck: buildStuck(arg("--partial") ?? text, arg("--es") ?? "", history),
      review: buildReview(text, null, history),
    };
    const p = (prompts as Record<string, unknown>)[cmd];
    if (!p) {
      console.error("unknown command for --print-prompts");
      process.exit(2);
    }
    console.log(JSON.stringify(p, null, 2));
    return;
  }

  if (llmMode() === "mock" && !flag("--mock")) {
    console.error("note: ANTHROPIC_API_KEY not set — running in MOCK mode (canned responses).");
  }

  switch (cmd) {
    case "translate": {
      const out = await translate(need("--text"), true, history);
      console.log(JSON.stringify(out, null, 2));
      break;
    }
    case "openers": {
      const out = await openers(need("--es"), arg("--en") ?? "", history);
      console.log(JSON.stringify(out, null, 2));
      break;
    }
    case "stuck": {
      const out = await stuck(need("--partial"), arg("--es") ?? "", history);
      console.log(JSON.stringify(out, null, 2));
      break;
    }
    case "review": {
      const out = await review(need("--text"), null, history);
      console.log(JSON.stringify(out, null, 2));
      break;
    }
    default:
      console.error("usage: cli (translate|openers|stuck|review) [args] [--mock] [--print-prompts] [--history FILE]");
      process.exit(2);
  }
}

main().catch((e) => {
  console.error(`error: ${(e as Error).message}`);
  process.exit(1);
});
