// Dev B: Decision + GazeFrame -> EditRequest composer.
// Enforces catalog closure in code: a Jev op that has no Tier-1 executor
// (or a param outside the frozen tokens) degrades to op=null + route=small
// instead of shipping an unexecutable no-llm request. Returns null when there
// is no resolvable target — the caller treats that as drop/fail, never apply.

import {
  COLOR_TOKENS,
  RADIUS_TOKENS,
  SPACING_TOKENS,
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

let seq = 0;

function isColor(p: string): boolean {
  return (COLOR_TOKENS as readonly string[]).includes(p);
}

function isRadius(p: string): p is "sm" | "md" | "lg" | "full" {
  return (RADIUS_TOKENS as readonly string[]).includes(p);
}

function isSpacing(p: string): p is "tight" | "normal" | "loose" {
  return (SPACING_TOKENS as readonly string[]).includes(p);
}

function toEditOp(op: string | null, param: string | null): EditOp | null {
  switch (op) {
    case "set-color":
      return typeof param === "string" && isColor(param)
        ? { op: "set-color", param }
        : null;
    case "set-radius":
      return typeof param === "string" && isRadius(param)
        ? { op: "set-radius", param }
        : null;
    case "set-spacing":
      return typeof param === "string" && isSpacing(param)
        ? { op: "set-spacing", param }
        : null;
    case "hide":
      return { op: "hide", param: null };
    case "swap-text":
      return typeof param === "string" && param.length > 0
        ? { op: "swap-text", param }
        : null;
    default:
      // set-align, unknown verbs, or null: no Tier-1 executor — LLM generates.
      return null;
  }
}

export function composeEditRequest(input: ComposeInput): EditRequest | null {
  if (input.decision.target === null) return null;
  const target =
    input.frame.candidates.find((c) => c.id === input.decision.target) ??
    input.frame.lockedTarget;
  if (!target) return null;
  const op = toEditOp(input.decision.op, input.decision.param);
  // Closure enforcement: no-llm with an unexecutable op escalates to small.
  const route =
    input.decision.route === "no-llm" && op === null
      ? "small"
      : input.decision.route;
  const req: EditRequest = {
    id: input.id ?? `e-${Date.now().toString(36)}-${seq++}`,
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
