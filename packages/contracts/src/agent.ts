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
  | { op: "set-align"; param: AlignToken }
  | { op: "hide"; param: null }
  | { op: "swap-text"; param: string } // replaced text from the transcript span
export type ColorToken = string; // bounded by design tokens in design.md
export type RadiusToken = "sm" | "md" | "lg" | "full";
export type SpacingToken = "tight" | "normal" | "loose";
export type AlignToken = "left" | "center" | "right" | "justify";
export type ParamToken = ColorToken | RadiusToken | SpacingToken;

/** Design token catalogs — frozen from design.md at hour 3. */
export const COLOR_TOKENS = ["brand", "muted", "accent"] as const;
export const RADIUS_TOKENS = ["sm", "md", "lg", "full"] as const;
export const SPACING_TOKENS = ["tight", "normal", "loose"] as const;
export const ALIGN_TOKENS = ["left", "center", "right", "justify"] as const;

/** Code model freeze (grill-locked, replaces Haiku). Lite tier is inherently
 *  minimal-reasoning: the API accepts no thinking controls (probe 2026-10-03:
 *  thinkingBudget/thinkingLevel both 400), so temperature is the only knob. */
export const CODE_MODEL = {
  id: "gemini-3.5-flash-lite",
  temperature: 0.1,
} as const;

export interface EditRequest {
  id: string;
  transcript: string;
  intent: Intent;
  target: ElementCandidate;
  /** Tier-1 patch when op is non-null (route no-llm ignores generated diffs). */
  op: EditOp | null;
  route: Route;
  riskScore: number; // 0-1; auto-apply always; >= APPLY_THRESHOLD widens undo-window (grill-locked, no Confirm dialog)
  /** Parent as address-only (dev-c.md §5.4b): one level, no HTML on the wire.
   *  The executor resolves content at apply time via the data-source map. */
  parent?: ParentAddress;
  /** Cross-element context: other components named in the transcript
   *  ("same width as the hero heading"). Reader of the request (LLM or
   *  executor) uses these for match/mirror/relative edits. */
  references?: ElementCandidate[];
}

/** Address-only parent pointer. Carries no file contents across IPC. */
export interface ParentAddress {
  componentName: string | null;
  filePath: string | null;
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
 * no Confirm dialogs in the demo path. `git:confirm` survives only as the
 * power-path commit on a pre-commit sha, never as a PendingAction.
 */
export type PendingAction = "undo-window" | null;

export interface PipelineState {
  stage: PipelineStage;
  editId: string | null;
  pendingAction: PendingAction;
  statusLine: string | null; // e.g. "Editing Navbar.tsx…"
  error: string | null; // for "failed"; UI renders, no retry logic here
}
