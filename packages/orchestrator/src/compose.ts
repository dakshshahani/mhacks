// Dev B: Decision + GazeFrame -> EditRequest composer.
// Enforces catalog closure in code: a Jev op that has no Tier-1 executor
// (or a param outside the frozen tokens) degrades to op=null + route=small
// instead of shipping an unexecutable no-llm request. Returns null when there
// is no resolvable target — the caller treats that as drop/fail, never apply.

import {
  COLOR_TOKENS,
  RADIUS_TOKENS,
  SPACING_TOKENS,
  ALIGN_TOKENS,
  WEIGHT_TOKENS,
  SIZE_TOKENS,
  POLICY,
  type Decision,
  type EditOp,
  type EditRequest,
  type ElementCandidate,
  type GazeFrame,
} from "@mhacks/contracts";

export interface ComposeInput {
  id?: string;
  transcript: string;
  decision: Decision;
  frame: GazeFrame;
  references?: ElementCandidate[];
}

let editSeq = 0;

/** Single token table: op -> valid params. An op is Tier-1-executable iff
 *  it appears here with its param inside the frozen tokens. */
const TOKEN_SETS = {
  "set-color": COLOR_TOKENS,
  "set-radius": RADIUS_TOKENS,
  "set-spacing": SPACING_TOKENS,
  "set-align": ALIGN_TOKENS,
  "set-weight": WEIGHT_TOKENS,
  "set-size": SIZE_TOKENS,
} as const;
type TokenOp = keyof typeof TOKEN_SETS;

function toEditOp(op: string | null, param: string | null, sourceLine: number | null | undefined): EditOp | null {
  // Tier-1 patches scope to the target's own data-source line. Without it
  // (foreign probes report none) the renderer would edit the FIRST match in
  // the file — a wrong-element patch — so the op voids and the LLM generates
  // from the target selector + HTML instead.
  if (typeof sourceLine !== "number") return null;
  if (op === "hide") return { op: "hide", param: null };
  if (op === "swap-text") {
    return typeof param === "string" && param.length > 0
      ? { op: "swap-text", param }
      : null;
  }
  if (
    op !== null &&
    op in TOKEN_SETS &&
    typeof param === "string" &&
    (TOKEN_SETS[op as TokenOp] as readonly string[]).includes(param)
  ) {
    return { op, param } as EditOp;
  }
  // Unknown verbs or off-catalog params: no Tier-1 executor — LLM generates.
  return null;
}

export function composeEditRequest(input: ComposeInput): EditRequest | null {
  if (input.decision.target === null) return null;
  // Strict id join: a target absent from THIS frame (stale decision, gaze
  // moved on) resolves to null, never to a silent substitute. The caller must
  // compose against the frame the decision was made on.
  const target = input.frame.candidates.find(
    (c) => c.id === input.decision.target,
  );
  if (!target) return null;
  // Closure enforcement (dev-b.md §5): never force a catalog choice when the
  // truth isn't in the catalog. Below AUTOMATION_MIN the op is void even when
  // syntactically valid — the LLM generates instead.
  const catalogOk = input.decision.inCatalog >= POLICY.AUTOMATION_MIN;
  const op = catalogOk ? toEditOp(input.decision.op, input.decision.param, target.sourceLine) : null;
  // Escalation floor is small (LLM generates); a Jev large stays large.
  const route =
    input.decision.route === "no-llm" && op === null
      ? "small"
      : input.decision.route;
  const req: EditRequest = {
    id: input.id ?? `e-${Date.now().toString(36)}-${editSeq++}`,
    transcript: input.transcript,
    intent: input.decision.intent,
    target,
    op,
    route,
    riskScore: input.decision.riskScore,
  };
  if (input.references !== undefined) req.references = input.references;
  return req;
}
