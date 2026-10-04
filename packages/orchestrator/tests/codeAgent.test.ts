// Orchestrator: Flash-Lite fallback input shape tests.
// Contract: transcript + target (selector/component/file/HTML/crop) +
// projectContext. Verifies prompt carries file text, target grounding, and
// project scope, and that crops become image parts (prefix-tolerated).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { EditRequest, ElementCandidate } from "@mhacks/contracts";
import {
  buildContentParts,
  buildEditPrompt,
  chooseFile,
  stripFences,
} from "../src/codeAgent";

function candidate(over: Partial<ElementCandidate> = {}): ElementCandidate {
  return {
    id: "c0",
    selector: "div.hero",
    componentName: "Hero",
    filePath: "Hero.tsx",
    boundingRect: { x: 0, y: 0, width: 100, height: 40 },
    outerHTMLSnippet: `<div class="hero">Hello</div>`,
    htmlTruncated: false,
    confidence: 0.9,
    trackedConfidence: 0.9,
    supportedOps: [],
    ...over,
  };
}

function req(): EditRequest {
  return {
    id: "e-1",
    transcript: "make the corners fully round",
    intent: "layout",
    target: candidate(),
    op: null,
    route: "small",
    riskScore: 0.2,
  };
}

describe("flash-lite fallback input", () => {
  it("prompt carries file text, target grounding, and project scope", () => {
    const text = buildEditPrompt(req(), {
      currentText: `<div data-source="Hero.tsx:1">x</div>`,
      projectContext: "Template files: Hero.tsx",
    });
    assert.match(text, /complete updated file content/);
    assert.match(text, /data-source="Hero.tsx:1"/);
    assert.match(text, /selector=div\.hero/);
    assert.match(text, /Template files: Hero\.tsx/);
    assert.match(text, /data-source=.*byte-for-byte/);
  });

  it("no crop means a single text part", () => {
    const parts = buildContentParts(req(), { currentText: "x" });
    assert.equal(parts.length, 1);
    assert.ok("text" in parts[0]!);
  });

  it("crop becomes a png image part, data-url prefix stripped", () => {
    const withUrl = buildContentParts(req(), {});
    assert.equal(withUrl.length, 1);
    const r2: EditRequest = {
      ...req(),
      target: candidate({ screenshotCrop: "data:image/png;base64,AAA" }),
    };
    const parts = buildContentParts(r2, {});
    assert.equal(parts.length, 2);
    const img = parts[1]!;
    assert.ok("inline_data" in img);
    if ("inline_data" in img) {
      assert.equal(img.inline_data.mime_type, "image/png");
      assert.equal(img.inline_data.data, "AAA");
    }
  });

  it("stripFences unwraps fenced output, passes bare text through", () => {
    assert.equal(stripFences("```tsx\n<div>x</div>\n```"), "<div>x</div>");
    assert.equal(stripFences("<div>x</div>"), "<div>x</div>");
  });

  it("chooseFile accepts only listed members, rejects hallucinations", async () => {
    const input = {
      transcript: "make it blue",
      componentName: "GoButton",
      outerHTMLSnippet: "<button>Go</button>",
      candidates: ["src/a.tsx", "src/b.tsx"],
    };
    const ok = await chooseFile(input, {
      apiKey: "k",
      transport: () =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(""),
          json: () =>
            Promise.resolve({
              candidates: [{ content: { parts: [{ text: '```json\n{"file": "src/b.tsx"}\n```' }] } }],
            }),
        }),
    });
    assert.equal(ok, "src/b.tsx");

    const hallucinated = await chooseFile(input, {
      apiKey: "k",
      transport: () =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(""),
          json: () =>
            Promise.resolve({
              candidates: [{ content: { parts: [{ text: '{"file": "../../evil.ts"}' }] } }],
            }),
        }),
    });
    assert.equal(hallucinated, null);

    const garbage = await chooseFile(input, {
      apiKey: "k",
      transport: () =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(""),
          json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: "blue!" }] } }] }),
        }),
    });
    assert.equal(garbage, null);

    assert.equal(await chooseFile({ ...input, candidates: [] }, { apiKey: "k" }), null);
    assert.equal(await chooseFile(input, { apiKey: "" }), null);
  });
});
