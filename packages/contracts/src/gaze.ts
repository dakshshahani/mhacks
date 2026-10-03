// packages/contracts/src/gaze.ts — Dev A produces, Dev B + UI consume
import type { EditOp } from "./agent";

export type JSONRect = { x: number; y: number; width: number; height: number };

/** Stable per-probe identifier: joinable inside one GazeFrame, not durable. */
export type CandidateId = string;

/** One candidate element near the gaze point. JSON-safe: crosses webview/IPC. */
export interface ElementCandidate {
  id: CandidateId;
  selector: string;
  componentName: string | null;
  filePath: string | null; // from data-source attr; null if unmapped
  boundingRect: JSONRect;
  /** Truncated to 2KB; the truncated flag lets consumers distrust the tail. */
  outerHTMLSnippet: string;
  htmlTruncated: boolean;
  /** 0-1; conflates tracker confidence + snap quality. See trackedConfidence. */
  confidence: number;
  /** 0-1 raw tracker quality only, no snapping penalty. */
  trackedConfidence: number;
  /** Ops we can Tier-1 patch on this element, declared by the prober. */
  supportedOps: EditOp[];
  /** Optional target crop for the code model (base64 PNG, small — the prober
   *  captures the element region, not the screen). Null until Dev A supplies
   *  it; JSON-safe across webview/IPC. The Flash-Lite fallback input carries
   *  transcript + target (incl. this crop) + projectContext. */
  screenshotCrop?: string | null;
}

export interface GazeFrame {
  candidates: ElementCandidate[]; // top 2-5, ordered deterministically (DOM order)
  lockedTarget: ElementCandidate | null; // set when speech starts
  /** Timestamp for clock skew between webview and main. */
  capturedAt: number;
}

/** Dev A deliverable: works in any webview. */
export type QueryElementAt = (x: number, y: number) => Promise<GazeFrame>;

export type CalibrationStatus = "uncalibrated" | "calibrating" | "calibrated";

export interface GazeState {
  frame: GazeFrame | null;
  calibration: CalibrationStatus;
  sensitivity: { dwellMs: number; smoothing: number };
}
