// Orchestrator: catalog-closure composition tests.
// inCatalog below AUTOMATION_MIN voids even a syntactically valid op —
// the LLM generates instead of Tier-1 forcing a wrong deterministic patch.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { POLICY } from "@mhacks/contracts";
import type { Decision, ElementCandidate, GazeFrame } from "@mhacks/contracts";
import { composeEditRequest } from "../src/compose";

function candidate(): ElementCandidate {
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
    supportedOps: [{ op: "set-color", param: "brand" }],
  };
}

const frame: GazeFrame = { candidates: [candidate()], lockedTarget: null, capturedAt: 1 };

function decision(over: Partial<Decision> = {}): Decision {
  return {
    actionable: 1,
    target: "c0",
    intent: "style",
    op: "set-color",
    param: "brand",
    route: "no-llm",
    riskScore: 0.2,
    inCatalog: 1,
    confidence: 0.9,
    ...over,
  };
}

describe("composeEditRequest closure", () => {
  it("low inCatalog voids a valid op and escalates no-llm to small", () => {
    const req = composeEditRequest({
      transcript: "make it brand",
      decision: decision({ inCatalog: POLICY.AUTOMATION_MIN - 0.1 }),
      frame,
    });
    if (req === null) throw new Error("expected EditRequest");
    assert.equal(req.op, null);
    assert.equal(req.route, "small");
  });

  it("low inCatalog preserves a Jev large route", () => {
    const req = composeEditRequest({
      transcript: "rebuild the hero",
      decision: decision({ inCatalog: 0, route: "large", op: null, param: null }),
      frame,
    });
    if (req === null) throw new Error("expected EditRequest");
    assert.equal(req.op, null);
    assert.equal(req.route, "large");
  });

  it("high inCatalog keeps a valid catalog op on no-llm", () => {
    const req = composeEditRequest({
      transcript: "make it brand",
      decision: decision({ inCatalog: POLICY.AUTOMATION_MIN }),
      frame,
    });
    if (req === null) throw new Error("expected EditRequest");
    assert.deepEqual(req.op, { op: "set-color", param: "brand" });
    assert.equal(req.route, "no-llm");
  });

  it("unknown op degrades to small even at full confidence", () => {
    const req = composeEditRequest({
      transcript: "frob it",
      decision: decision({ op: "frob", param: "x", inCatalog: 1 }),
      frame,
    });
    if (req === null) throw new Error("expected EditRequest");
    assert.equal(req.op, null);
    assert.equal(req.route, "small");
  });

  it("stale target resolves to null, never a substitute", () => {
    const req = composeEditRequest({
      transcript: "make it brand",
      decision: decision({ target: "c9" }),
      frame,
    });
    assert.equal(req, null);
  });
});
