// packages/contracts/src/agent.ts — Dev B produces, Dev C executes

import type { ElementCandidate } from "./gaze";
import type { Intent, Route } from "./decision";

/**
 * Fixed verb catalog. Tier-1 patches branch exhaustively on this union —
 * adding an op means updating shared/policy code, never a free string.
 * Each op names the param shape it accepts.
 */
export type EditOp =
  | { op: "set-color"; param: ColorToken }
  | { op: "set-radius"; param: RadiusToken }
  | { op: "set-spacing"; param: SpacingToken }
  | { op: "hide"; param: null }
  | { op: "swap-text"; param: string } // replaced text from the transcript span
export type ColorToken = string; // bounded by design tokens in design.md
export type RadiusToken = "sm" | "md" | "lg" | "full";
export type SpacingToken = "tight" | "normal" | "loose";
export type ParamToken = ColorToken | RadiusToken | SpacingToken;

/** Design token catalogs — frozen from design.md at hour 3. */
export const COLOR_TOKENS = ["brand", "muted", "accent"] as const;
export const RADIUS_TOKENS = ["sm", "md", "lg", "full"] as const;
export const SPACING_TOKENS = ["tight", "normal", "loose"] as const;

export interface EditRequest {
  id: string;
  transcript: string;
  intent: Intent;
  target: ElementCandidate;
  /** Tier-1 patch when op is non-null (route no-llm ignores generated diffs). */
  op: EditOp | null;
  route: Route;
  riskScore: number; // 0-1; >=0.8 auto-apply, otherwise Confirm required
}

export type EditStatus = "applied" | "build-failed" | "retry-exhausted";

export interface EditResult {
  id: string;
  status: EditStatus;
  filesChanged: string[];
  commitSha: string; // Dev C always pre-commits, so Undo always exists
  durationMs: number;
  hotReloaded: boolean; // did HMR pick it up
}

/** Dev B's seam: real agent and mock both implement this. */
export interface CodeAgent {
  submitEdit(req: EditRequest): Promise<EditResult>;
}

export type PipelineStage =
  | "idle"
  | "listening"
  | "locked"
  | "editing"
  | "verifying"
  | "applied"
  | "failed";

/**
 * Apply UX (locked by grill interview): every edit auto-applies; a 5s undo
 * circle appears and ~500ms gaze dwell (or a click) on it reverts the edit.
 * `undo-window` drives that circle; longer/higher risk widens it. There are
 * no Confirm dialogs in the demo path.
 */
export type PendingAction = "undo-window" | "confirm" | null;

export interface PipelineState {
  stage: PipelineStage;
  editId: string | null;
  pendingAction: PendingAction;
  statusLine: string | null; // e.g. "Editing Navbar.tsx…"
  error: string | null; // for "failed"; UI renders, no retry logic here
}
