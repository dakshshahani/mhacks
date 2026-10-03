// Repo probe: 6 Jev decisions + compose + verify + 1 Flash-Lite diff (~cents).
// Run: pnpm --filter @mhacks/orchestrator probe   (keys via ../../.env)
// Every POLICY tuning must cite a probe run like this one.
import { createJevLayer, verifyDecision } from "../src/jev.ts";
import { generateNarrowDiff } from "../src/codeAgent.ts";
import { composeEditRequest } from "../src/compose.ts";
import { POLICY } from "@mhacks/contracts";

const cand = (id, name, file) => ({
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
  cand("hero", "Hero", "Hero.tsx"),
  cand("button", "PrimaryButton", "Hero.jsx"),
  cand("footer", "Footer", "Footer.jsx"),
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
for (const t of cases) {
  const t0 = Date.now();
  const d = await layer.decide({
    transcript: t,
    pointer: { x: 400, y: 300 },
    pointerOver: "hero",
    components: COMPONENTS,
  });
  const ms = Date.now() - t0;
  const dropped = d.actionable < POLICY.ACTIONABLE_MIN || d.target === null;
  const req = dropped
    ? null
    : composeEditRequest({
      transcript: t,
      decision: d,
      frame: { candidates: COMPONENTS, lockedTarget: null, capturedAt: Date.now() },
    });
  console.log(JSON.stringify({
    t,
    ms,
    act: d.actionable,
    dropped,
    target: d.target,
    intent: d.intent,
    op: d.op,
    route: d.route,
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
