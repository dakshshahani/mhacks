// apps/desktop/src/decide.ts — harness integration: Dev B decides, Dev C applies.
//
// This module is the G2/G3 seam. It composes the orchestrator (DecisionLayer,
// composeEditRequest, verifyDecision, PipelineMachine — all Dev B) with the
// shell (PreviewHost frame, IpcRouter agent:submitEdit, SpeechService — all
// Dev C, injected as deps so this file never touches the real world itself).
//
// The canned `demoEditRequest` path it replaces built the EditRequest by hand
// in the browser. Here the EditRequest only ever comes from
// composeEditRequest() — the mock/real switch lives in which DecisionLayer
// the server injects (mockJev with no key / MOCK_JEV=1, live Jev otherwise).

import {
  POLICY,
  type Decision,
  type DecisionInput,
  type DecisionLayer,
  type EditRequest,
  type EditResult,
  type ElementCandidate,
  type GazeFrame,
  type IpcResult,
  type ParentAddress,
} from "@mhacks/contracts";
import type { PipelineMachine } from "@mhacks/orchestrator";
import { composeEditRequest } from "@mhacks/orchestrator";

export const UNDO_WINDOW_MS = 5000;
export const UNDO_WINDOW_RISKY_MS = 8000;

/** Risk widens the undo window; never gates a dialog (grill-locked). */
export function undoWindowMs(riskScore: number): number {
  return riskScore >= POLICY.APPLY_THRESHOLD ? UNDO_WINDOW_RISKY_MS : UNDO_WINDOW_MS;
}

/** Naive span extraction for DecisionInput.textSpans — quoted phrases only,
 *  capped at 5. Kept dumb on purpose (dev-b.md §5). */
export function extractTextSpans(transcript: string): string[] {
  const spans: string[] = [];
  const re = /["“”']([^"“”']{1,120})["“”']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(transcript)) !== null && spans.length < 5) {
    const s = (m[1] ?? "").trim();
    if (s.length > 0) spans.push(s);
  }
  return spans;
}

/** Candidate id under the point (containment); null when gaze/click is on
 *  empty space. Contract §6.1: id only, never a name/label. */
export function findPointerOver(
  candidates: ElementCandidate[],
  x: number,
  y: number,
): string | null {
  for (const c of candidates) {
    const r = c.boundingRect;
    if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) {
      return c.id;
    }
  }
  return null;
}

/** Closed-catalog input for Jev: trimmed transcript + point + visible list in
 *  DOM order (never shuffled — ordering is part of Jev's input). No HTML
 *  crosses into Jev (prompt-injection rule); snippets go to the code model
 *  only, via the EditRequest target. A frozen lock-on id (Dev A) wins over
 *  point containment when present. */
export function buildDecisionInput(
  transcript: string,
  x: number,
  y: number,
  frame: GazeFrame,
  lockedId: string | null = null,
): DecisionInput {
  const components = frame.candidates.slice(0, POLICY.MAX_CANDIDATES);
  const validIds = new Set(components.map((c) => c.id));
  const input: DecisionInput = {
    transcript: transcript.slice(0, 2000),
    pointer: { x, y },
    pointerOver:
      lockedId !== null && validIds.has(lockedId)
        ? lockedId
        : findPointerOver(components, x, y),
    components,
  };
  const spans = extractTextSpans(transcript);
  if (spans.length > 0) input.textSpans = spans;
  return input;
}

function mentionName(c: ElementCandidate): string[] {
  const names = [c.componentName ?? "", (c.filePath ?? "").replace(/\.[^.]+$/, "")];
  return names.map((n) => n.toLowerCase()).filter((n) => n.length > 0);
}

/** Cross-element context (§5.4b) from live state only — never fabricated.
 *  Other frame candidates named in the transcript become references; the
 *  first becomes the parent address. Empty when nothing is named. */
export function resolveContext(
  transcript: string,
  frame: GazeFrame,
  targetId: string,
): { parent?: ParentAddress; references?: ElementCandidate[] } {
  const lowered = transcript.toLowerCase();
  const refs = frame.candidates.filter((c) => {
    if (c.id === targetId) return false;
    return mentionName(c).some((n) => lowered.includes(n));
  });
  if (refs.length === 0) return {};
  const first = refs[0] as ElementCandidate;
  return {
    parent: { componentName: first.componentName, filePath: first.filePath },
    references: refs,
  };
}

export interface DecideServices {
  decide: DecisionLayer;
  /** Dev C truth boundary (IpcRouter agent:submitEdit). */
  submitEdit: (req: EditRequest) => Promise<IpcResult<EditResult>>;
  verify?: (transcript: string, diffSummary: string) => Promise<{ matches: number }>;
  pipeline: PipelineMachine;
  speech: {
    currentState: string;
    start: () => { ok: true } | { ok: false; message: string };
    pushTranscript: (text: string, isFinal: boolean) => void;
    resetToIdle: () => void;
  };
  /** Dev C preview probe (envelope already unwrapped by the caller). */
  queryFrame: (x: number, y: number) => Promise<GazeFrame>;
}

export type DecideOutcome =
  | {
      kind: "applied";
      decision: Decision;
      editRequest: EditRequest;
      editResult: EditResult;
      undoWindowMs: number;
      verified: boolean;
    }
  | { kind: "dropped"; decision: Decision }
  | { kind: "busy"; message: string }
  | { kind: "error"; message: string };

function diffSummaryFor(req: EditRequest, result: EditResult): string {
  return (
    `intent=${req.intent} ` +
    `op=${req.op === null ? "custom" : JSON.stringify(req.op)} ` +
    `files=${result.filesChanged.join(",")} ` +
    `newText=${(result.diffExcerpt ?? "").slice(0, 800)}`
  );
}

/** One full utterance: gaze frame → Jev → compose → executor → verify.
 *  Drives the shared PipelineMachine through every stage; the server
 *  broadcasts each transition over SSE and the UI renders from that. */
export async function decideAndEdit(
  transcript: string,
  x: number,
  y: number,
  services: DecideServices,
): Promise<DecideOutcome> {
  const { pipeline, speech } = services;
  const stage = pipeline.getState().stage;
  if (stage === "listening" || stage === "locked" || stage === "editing" || stage === "verifying") {
    return { kind: "busy", message: `pipeline is ${stage}; wait for applied/failed` };
  }

  const text = transcript.trim();
  if (text.length === 0) {
    return { kind: "error", message: "empty transcript: nothing to decide" };
  }

  // Mic truth: an utterance starts with listening (also Dev A's lock-on
  // signal). Text input counts as the recognizer in the harness.
  if (speech.currentState === "off") {
    speech.start();
  }

  const frame = await services.queryFrame(x, y);
  pipeline.startListening();

  // Harness lock-on emulation: Dev A's client freezes lockedTarget on
  // speech:start; the canned probe leaves it null, so freeze the top
  // candidate here until the real gaze client supplies it.
  const lockedTarget = frame.lockedTarget ?? frame.candidates[0] ?? null;

  const input = buildDecisionInput(text, x, y, frame, lockedTarget?.id ?? null);
  const decision = await services.decide.decide(input);

  if (decision.actionable < POLICY.ACTIONABLE_MIN || decision.target === null) {
    pipeline.reset();
    speech.resetToIdle();
    return { kind: "dropped", decision };
  }

  const composed = composeEditRequest({ transcript: text, decision, frame });
  if (composed === null) {
    pipeline.fail("target left the frame before the edit composed");
    speech.resetToIdle();
    return { kind: "error", message: "target left the frame; nothing applied" };
  }
  const ctx = decision.target !== null ? resolveContext(text, frame, decision.target) : {};
  const req: EditRequest = composed;
  if (ctx.parent !== undefined) req.parent = ctx.parent;
  if (ctx.references !== undefined) req.references = ctx.references;

  const label = req.target.componentName ?? req.target.filePath ?? req.target.id;
  pipeline.lock(label);
  pipeline.startEditing(req.id, `Editing ${req.target.filePath ?? label}…`);
  speech.pushTranscript(text, true);

  const submit = await services.submitEdit(req);
  if (!submit.ok) {
    pipeline.fail(submit.message);
    speech.resetToIdle();
    return { kind: "error", message: submit.message };
  }

  // Verify is skipped on no-llm (build + Undo covers it). On small/large a
  // single advisory Jev noul pass runs — advisory because a re-submit with an
  // identical prompt rarely improves anything yet costs a second stacked edit
  // (which breaks one-send-one-undo). Low verify therefore flags the result
  // instead of retrying: the build gate passed and Undo covers it.
  pipeline.startVerifying();
  let verified = false;
  if (req.route !== "no-llm" && services.verify) {
    const first = await services.verify(text, diffSummaryFor(req, submit.value));
    verified = first.matches >= POLICY.RETRY_THRESHOLD;
  }

  pipeline.apply();
  speech.resetToIdle();
  return {
    kind: "applied",
    decision,
    editRequest: req,
    editResult: submit.value,
    undoWindowMs: undoWindowMs(decision.riskScore),
    verified,
  };
}
