import { build } from "esbuild";
import * as path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");

await build({
  entryPoints: [path.join(root, "web", "src", "app.ts")],
  bundle: true,
  format: "iife",
  target: ["es2020"],
  outfile: path.join(root, "web", "dist", "app.js"),
  sourcemap: true,
  logLevel: "info",
});
