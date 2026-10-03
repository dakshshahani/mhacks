// Dev B: pipeline state machine. Only the orchestrator mutates it; everyone
// else subscribes. Illegal transitions are ignored, never thrown.

import type { PipelineState } from "@mhacks/contracts";

export type PipelineListener = (state: PipelineState) => void;

const INITIAL: PipelineState = {
  stage: "idle",
  editId: null,
  pendingAction: null,
  statusLine: null,
  error: null,
};

export class PipelineMachine {
  private state: PipelineState = { ...INITIAL };
  private listeners = new Set<PipelineListener>();

  getState(): PipelineState {
    return { ...this.state };
  }

  subscribe(fn: PipelineListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private set(patch: Partial<PipelineState>): void {
    this.state = { ...this.state, ...patch };
    const snapshot = this.getState();
    for (const fn of this.listeners) fn(snapshot);
  }

  /** idle/applied/failed -> listening. Opens a new utterance. */
  startListening(): void {
    if (
      this.state.stage !== "idle" &&
      this.state.stage !== "applied" &&
      this.state.stage !== "failed"
    ) {
      return;
    }
    this.set({
      stage: "listening",
      editId: null,
      pendingAction: null,
      statusLine: "Listening…",
      error: null,
    });
  }

  lock(label: string): void {
    if (this.state.stage !== "listening") return;
    this.set({ stage: "locked", statusLine: `Locked on ${label}…` });
  }

  startEditing(editId: string, statusLine: string): void {
    if (this.state.stage !== "locked") return;
    this.set({ stage: "editing", editId, statusLine, error: null });
  }

  startVerifying(): void {
    if (this.state.stage !== "editing") return;
    this.set({ stage: "verifying", statusLine: "Verifying…" });
  }

  /** verifying/editing -> applied. Every edit auto-applies; undo circle drives revert. */
  apply(): void {
    if (this.state.stage !== "verifying" && this.state.stage !== "editing") {
      return;
    }
    this.set({
      stage: "applied",
      pendingAction: "undo-window",
      statusLine: null,
    });
  }

  fail(error: string): void {
    this.set({ stage: "failed", pendingAction: null, error });
  }

  reset(): void {
    this.set({ ...INITIAL });
  }
}
