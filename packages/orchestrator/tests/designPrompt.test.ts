// Design-prompt shape tests: the generator's system prompt must carry the
// skill rules that keep scaffolds non-templated, plus the fixed file-set
// contract the parser enforces.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SCAFFOLD_FILES,
  buildScaffoldSystemPrompt,
  buildScaffoldUserPrompt,
} from "../src/designPrompt";

describe("designPrompt", () => {
  it("pins the zero-dep five-file contract", () => {
    assert.deepEqual([...SCAFFOLD_FILES], [
      "package.json",
      "server.mjs",
      "index.html",
      "styles.css",
      "main.js",
    ]);
    const sys = buildScaffoldSystemPrompt();
    for (const f of SCAFFOLD_FILES) assert.match(sys, new RegExp(f.replace(".", "\\.")));
    assert.match(sys, /### FILE:/);
    assert.match(sys, /no dependencies/i);
  });

  it("carries the anti-slop rules that matter most", () => {
    const sys = buildScaffoldSystemPrompt();
    for (const rule of [
      /design read/i,
      /eyebrow/i,
      /prefers-reduced-motion/,
      /picsum\.photos\/seed/,
      /max 2 lines/i,
      /one accent/i,
    ]) {
      assert.match(sys, rule, `missing rule: ${rule}`);
    }
  });

  it("grounds the user prompt in the spoken brief + slug", () => {
    const out = buildScaffoldUserPrompt("a portfolio for my dog photos", "dog-photos");
    assert.match(out, /dog photos/);
    assert.match(out, /dog-photos/);
  });
});
