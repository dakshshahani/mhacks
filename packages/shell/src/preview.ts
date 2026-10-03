// Dev C: preview host for `preview:queryElementAt`.
// Hosts Dev A's probe inside the webview context; the shell never implements
// probing logic itself. Overlay hits are excluded by agreement on
// [data-gaze-overlay] (PM + Dev A).

import type { GazeFrame, QueryElementAt } from "../../contracts/src/gaze";
import type { IpcResult } from "../../contracts/src/ipc";

/** Attribute PM renders overlay layers with; prober must ignore this subtree. */
export const GAZE_OVERLAY_ATTR = "data-gaze-overlay";

export class PreviewHost {
  private probe: QueryElementAt | null = null;
  private ready = false;

  /** Browser harness counts as ready; Electron webview sets ready when attached. */
  setProbe(fn: QueryElementAt | null, ready: boolean): void {
    this.probe = fn;
    this.ready = ready;
  }

  get isReady(): boolean {
    return this.ready && this.probe !== null;
  }

  async queryElementAt(x: number, y: number): Promise<IpcResult<GazeFrame>> {
    if (!this.ready || !this.probe) {
      return { ok: false, code: "not-ready", message: "preview not ready" };
    }
    try {
      const frame = await this.probe(x, y);
      if (!frame || !Array.isArray(frame.candidates)) {
        return { ok: false, code: "wv-gone", message: "webview returned no frame" };
      }
      // JSON-safe enforcement: must survive structured serialization.
      JSON.stringify(frame);
      return { ok: true, value: frame };
    } catch (err) {
      return { ok: false, code: "wv-gone", message: err instanceof Error ? err.message : String(err) };
    }
  }
}
