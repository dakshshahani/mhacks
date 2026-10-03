// Dev C: IPC res side — the only writer of ipc.ts channels.
// Every invoke returns an IpcResult envelope; never throws across IPC.
// Events (pipeline:state, speech:*) are transported, never mutated here.

import type { CalibrationStatus } from "@mhacks/contracts";
import type { EditRequest } from "@mhacks/contracts";
import type { IpcChannelMap, IpcResult } from "@mhacks/contracts";
import type { FileGitService } from "./git";
import { submitEdit, type ExecutorDeps } from "./executor";
import type { PreviewHost } from "./preview";
import type { SpeechService } from "./speech";

export type InvokeChannel = Exclude<keyof IpcChannelMap, "pipeline:state" | "speech:transcript" | "speech:state">;

export interface RouterDeps {
  git: FileGitService;
  preview: PreviewHost;
  speech: SpeechService;
  executorDeps: Omit<ExecutorDeps, "git">;
  calibration?: CalibrationStatus;
}

function notReady(message: string): IpcResult<never> {
  return { ok: false, code: "not-ready", message };
}

export class IpcRouter {
  private calibration: CalibrationStatus = "uncalibrated";
  private readonly deps: RouterDeps;

  constructor(deps: RouterDeps) {
    this.deps = deps;
    if (deps.calibration) this.calibration = deps.calibration;
  }

  getCalibration(): CalibrationStatus {
    return this.calibration;
  }

  async invoke<K extends InvokeChannel>(
    channel: K,
    req: IpcChannelMap[K] extends { req: infer R } ? R : never,
  ): Promise<IpcChannelMap[K] extends { res: infer S } ? S : never> {
    switch (channel) {
      case "preview:queryElementAt": {
        const { x, y } = req as { x: number; y: number };
        const res = await this.deps.preview.queryElementAt(x, y);
        return res as never;
      }
      case "preview:setCalibration": {
        const { status } = req as { status: CalibrationStatus };
        this.calibration = status;
        return { ok: true, value: undefined } as never;
      }
      case "agent:submitEdit": {
        const res = await submitEdit(req as EditRequest, {
          ...this.deps.executorDeps,
          git: this.deps.git,
        });
        return res as never;
      }
      case "git:createSnapshot": {
        const { label } = req as { label: string };
        try {
          const snap = await this.deps.git.createSnapshot(label);
          return { ok: true, value: { sha: snap.sha } } as never;
        } catch (err) {
          return { ok: false, code: "unknown", message: String(err) } as never;
        }
      }
      case "git:undo": {
        try {
          const { snap } = await this.deps.git.undo();
          return { ok: true, value: { sha: snap.sha } } as never;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (message.includes("nothing to undo")) return notReady(message) as never;
          return { ok: false, code: "unknown", message } as never;
        }
      }
      case "git:confirm": {
        const { sha } = req as { sha: string };
        try {
          const found = await this.deps.git.confirm(sha);
          return { ok: true, value: { sha: found.sha } } as never;
        } catch (err) {
          return { ok: false, code: "unknown", message: String(err) } as never;
        }
      }
      case "git:history": {
        const list = await this.deps.git.history();
        return {
          ok: true,
          value: list.map((s) => ({ sha: s.sha, label: s.label, at: s.at })),
        } as never;
      }
      case "speech:start": {
        const r = this.deps.speech.start();
        if (!r.ok) return notReady(r.message) as never;
        return { ok: true, value: { streamId: r.streamId } } as never;
      }
      case "speech:stop": {
        this.deps.speech.stop();
        return { ok: true, value: undefined } as never;
      }
      default:
        return { ok: false, code: "unknown", message: `unknown channel ${String(channel)}` } as never;
    }
  }
}
