// packages/contracts/src/ipc.ts — Dev C implements channels; all payload types
// must reference gaze.ts / agent.ts / decision.ts types, not ad-hoc shapes.
// Only serialized JSON crosses the webview/IPC boundary.

import type { GazeFrame, CalibrationStatus } from "./gaze";
import type { EditRequest, EditResult, PipelineState } from "./agent";
import type { SpeechEvent, SpeechState } from "./decision";

/** Every invoke result is an envelope so failures are typed end to end. */
export type IpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: "not-ready" | "wv-gone" | "build-failed" | "unknown"; message: string };

export interface IpcChannelMap {
  // Dev A + Dev C: probe the preview webview for candidates at a point
  "preview:queryElementAt": {
    req: { x: number; y: number };
    res: IpcResult<GazeFrame>;
  };
  "preview:setCalibration": {
    req: { status: CalibrationStatus };
    res: IpcResult<undefined>;
  };

  // Dev B + Dev C: orchestrator -> shell side effects
  "agent:submitEdit": { req: EditRequest; res: IpcResult<EditResult> };
  "pipeline:state": { event: PipelineState };

  // Dev C: git-as-buttons. createSnapshot doubles as "New Version".
  "git:createSnapshot": { req: { label: string }; res: IpcResult<{ sha: string }> };
  "git:undo": { req: undefined; res: IpcResult<{ sha: string }> };
  "git:confirm": { req: { sha: string }; res: IpcResult<{ sha: string }> };
  // History pane: first click checks out the snapshot (working tree only,
  // history untouched); clicking the checked-out entry again reverts to it
  // and drops everything above it from history.
  "git:checkout": { req: { sha: string }; res: IpcResult<{ sha: string }> };
  "git:revertTo": { req: { sha: string }; res: IpcResult<{ sha: string }> };
  "git:history": {
    req: undefined;
    res: IpcResult<{ sha: string; label: string; at: number }[]>;
  };

  // Speech: shell owns the mic stream, emits transcripts
  "speech:start": { req: undefined; res: IpcResult<{ streamId: string }> };
  "speech:stop": { req: undefined; res: IpcResult<undefined> };
  "speech:transcript": { event: SpeechEvent };
  "speech:state": { event: SpeechState };
}

export type IpcChannelName = keyof IpcChannelMap;
