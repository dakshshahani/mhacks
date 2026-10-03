// packages/contracts/src/decision.ts — Dev B produces/consumes; Jev client only

import type { ElementCandidate } from "./gaze";

export type Intent =
  | "style"
  | "layout"
  | "content"
  | "add"
  | "delete"
  | "other";

export type Route = "no-llm" | "small" | "large";

/** Speech states — UI renders from this, never from speech internals. */
export type SpeechState = "off" | "listening" | "processing";

export interface SpeechEvent {
  text: string;
  isFinal: boolean;
}

/** Built at call time from visible components + transcript spans (closed set). */
export interface DecisionInput {
  transcript: string;
  pointer: { x: number; y: number } | null;
  pointerOver: string | null;
  components: ElementCandidate[]; // visible component list — criteria source
  textSpans?: string[]; // extracted candidate spans from transcript
}

export interface Decision {
  /** noul gate: 1 = actionable edit, 0 = background chatter. Drop below min. */
  actionable: number;
  /** CandidateId from DecisionInput.components, or null if not actionable. */
  target: string | null;
  intent: Intent;
  /** Verb from the catalog; null + route=llm means generate the edit. */
  op: string | null;
  param: string | null;
  route: Route;
  riskScore: number; // 0-1; >= APPLY_THRESHOLD widens undo-window; never a Confirm dialog (grill-locked auto-apply)
  /** noul gate: 1 = handling it via catalog is correct, 0 = escalate to LLM. */
  inCatalog: number;
  confidence: number; // margin, NOT probability of correctness — per vendor docs
}

/** Dev B's seam: real Jev client and the cheap-LLM stub both implement this. */
export interface DecisionLayer {
  decide(input: DecisionInput): Promise<Decision>;
}

/** Verification pass: does the applied diff match what was asked? */
export interface VerifyDecision {
  matches: number; // 0-1 noul; below RETRY_THRESHOLD triggers one retry
}

/** Thresholds live in code, not in Jev — code owns policy.
 *  Grill-locked: APPLY_THRESHOLD widens the undo-window, never gates a dialog.
 *  Retry: cap 3 error-fed build retries, then revert + fail card (user vote for
 *  unlimited overruled per griller objection, resolved at freeze).
 *  Tuning any value requires noting the probe run that informed it. */
export const POLICY = {
  APPLY_THRESHOLD: 0.8, // riskScore >= this widens undo-window; no Confirm in demo path
  AUTOMATION_MIN: 0.7, // inCatalog below this routes to LLM
  ACTIONABLE_MIN: 0.6, // actionable below this is dropped as chatter
  RETRY_THRESHOLD: 0.7, // verify.matches below this triggers one retry
  MAX_RETRIES: 3, // build-gate retries max; then revert + "couldn't apply" card
  MAX_CANDIDATES: 5,
  DECISION_TIMEOUT_MS: 1500,
  STATE_TOKEN_BUDGET: 20_000, // stay under Jev's 32k shared limit with headroom
} as const;
