// Repo probe: 6 Jev decisions + compose + verify + 1 Flash-Lite diff (~cents).
// Run: pnpm --filter @mhacks/orchestrator probe   (keys via ../../.env)
// Every POLICY tuning must cite a probe run like this one.
import { createJevLayer, verifyDecision } from "../src/jev.ts";
import { generateNarrowDiff } from "../src/codeAgent.ts";
import { composeEditRequest } from "../src/compose.ts";
import { POLICY } from "@mhacks/contracts";

const candidate = (id, name, file) => ({
  id,
  selector: `.${id}`,
  componentName: name,
  filePath: file,
  boundingRect: { x: 0, y: 0, width: 100, height: 40 },
  outerHTMLSnippet: `<div class="${id}">x</div>`,
  htmlTruncated: false,
  confidence: 1,
  trackedConfidence: 0.9,
  supportedOps: [],
});
const COMPONENTS = [
  candidate("hero", "Hero", "Hero.tsx"),
  candidate("button", "PrimaryButton", "Hero.jsx"),
  candidate("footer", "Footer", "Footer.jsx"),
];

const cases = [
  "make the hero blue",
  "hide the footer",
  "so anyway what do you want for lunch",
  "left align the hero subtitle",
  "make it a yellow to green gradient",
  "xyzzy",
];

const layer = createJevLayer();
for (const transcript of cases) {
  const t0 = Date.now();
  const decision = await layer.decide({
    transcript,
    pointer: { x: 400, y: 300 },
    pointerOver: "hero",
    components: COMPONENTS,
  });
  const ms = Date.now() - t0;
  const dropped = decision.actionable < POLICY.ACTIONABLE_MIN || decision.target === null;
  const req = dropped
    ? null
    : composeEditRequest({
      transcript,
      decision,
      frame: { candidates: COMPONENTS, lockedTarget: null, capturedAt: Date.now() },
    });
  console.log(JSON.stringify({
    t: transcript,
    ms,
    act: decision.actionable,
    dropped,
    target: decision.target,
    intent: decision.intent,
    op: decision.op,
    route: decision.route,
    composed: req === null ? null : { op: req.op, route: req.route },
  }));
}

const diff = await generateNarrowDiff({
  id: "probe1",
  transcript: "make the hero blue",
  intent: "style",
  target: COMPONENTS[0],
  op: null,
  route: "small",
  riskScore: 0.2,
});
console.log(JSON.stringify({ diffChars: diff === null ? null : diff.length }));
console.log(JSON.stringify({ policy: POLICY }));
