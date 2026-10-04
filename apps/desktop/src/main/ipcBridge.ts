// ipcMain ↔ services bridge (E4). Contract channels delegate 1:1 to the
// shared IpcRouter (same envelopes as the harness /api/invoke); local
// channels (decide/transcript/transcribe/preview/guest) are shell-only and
// intentionally NOT in packages/contracts (no cross-team surface).
//
// Events (pipeline/speech) leave via webContents.send on the contract event
// channels. The bridge never throws: service errors are already envelopes.

import type { BrowserWindow as BrowserWindowType } from "electron";
import { electron } from "./electron";
import type { IpcRouter, SpeechService } from "@mhacks/shell";
import type { DecideBody } from "./decideHandler";
import { MAX_AUDIO_BYTES, transcribeWithScribe } from "./scribe";

const { ipcMain, systemPreferences } = electron;

/** Every IpcChannelMap invoke channel (events excluded). */
const CONTRACT_INVOKE = [
  "preview:queryElementAt",
  "preview:setCalibration",
  "agent:submitEdit",
  "git:createSnapshot",
  "git:undo",
  "git:confirm",
  "git:history",
  "speech:stop",
] as const;

export interface BridgeDeps {
  router: IpcRouter;
  speech: SpeechService;
  decide: (body: DecideBody) => Promise<{ status: number; body: unknown }>;
  reloadPreview: () => Promise<void>;
  guestPreloadURL: () => string;
  getWindow: () => BrowserWindowType | null;
}

export function sendToShell(deps: Pick<BridgeDeps, "getWindow">, channel: string, payload: unknown): void {
  try {
    deps.getWindow()?.webContents.send(channel, payload);
  } catch {
    // Window gone mid-flight (reload/quit) — events are lossy by design.
  }
}

export function registerBridge(deps: BridgeDeps): void {
  for (const channel of CONTRACT_INVOKE) {
    ipcMain.handle(channel, (_event, req: unknown) =>
      deps.router.invoke(channel, req as never),
    );
  }

  // speech:start with a macOS mic gate: ask the OS first so a deny becomes
  // a clean not-ready/silence path instead of a dead recognizer. Failures
  // here never throw — the recognizer fallback (type-in-box) still works.
  ipcMain.handle("speech:start", async () => {
    if (process.platform === "darwin") {
      try {
        if (systemPreferences.getMediaAccessStatus("microphone") !== "granted") {
          await systemPreferences.askForMediaAccess("microphone");
        }
      } catch {
        // Deny/unsupported: fall through; SpeechService + UI still function.
      }
    }
    return deps.router.invoke("speech:start", undefined);
  });

  // Full utterance pipeline (mirrors POST /api/decide-and-edit shapes).
  ipcMain.handle("pipeline:decideAndEdit", (_event, body: DecideBody) => deps.decide(body));

  // Recognizer text into the shell state machine (mirrors POST /api/transcript).
  ipcMain.handle(
    "speech:pushTranscript",
    (_event, req: { text?: unknown; isFinal?: unknown }) => {
      const text = typeof req?.text === "string" ? req.text : "";
      deps.speech.pushTranscript(text, req?.isFinal !== false);
      return { ok: true, value: { state: deps.speech.currentState } };
    },
  );

  // Scribe fallback (mirrors POST /api/transcribe; key stays in main).
  ipcMain.handle(
    "speech:transcribe",
    async (_event, req: { audio?: unknown; mimeType?: unknown }) => {
      const mimeType = typeof req?.mimeType === "string" ? req.mimeType : "audio/webm";
      if (!mimeType.startsWith("audio/")) {
        return { ok: false, code: "unknown", message: "expected an audio/* body" };
      }
      const audio = req?.audio;
      const bytes =
        audio instanceof Uint8Array ? audio : audio instanceof ArrayBuffer ? new Uint8Array(audio) : null;
      if (!bytes || bytes.length === 0) {
        return { ok: false, code: "unknown", message: "empty audio" };
      }
      if (bytes.length > MAX_AUDIO_BYTES) {
        return { ok: false, code: "unknown", message: "audio too large (>10MB)" };
      }
      return transcribeWithScribe(bytes, mimeType);
    },
  );

  // Regenerate the data: URL preview (renderer calls after apply/undo, and
  // once at startup after setting the guest preload — manager pends until
  // the guest exists, so the handshake is race-free).
  ipcMain.handle("preview:reload", async () => {
    await deps.reloadPreview();
    return { ok: true, value: { reloaded: true } };
  });

  // Guest preload file URL (dev: repo file; packaged: extraResources).
  ipcMain.handle("shell:guestPreload", () => ({ ok: true, value: { url: deps.guestPreloadURL() } }));

  // OS permission gate (camera/mic). The renderer's getUserMedia needs BOTH
  // the Chromium grant (permission handler in app.ts) AND the macOS TCC
  // grant — this call produces the OS prompt on first use. Without it the
  // device silently stays denied (no prompt ever appears). Non-macOS and
  // harness (no bridge) resolve without asking.
  ipcMain.handle("shell:ensureMediaAccess", async (_event, kind: unknown) => {
    const media = kind === "camera" ? "camera" : "microphone";
    if (process.platform !== "darwin") {
      return { ok: true, value: { status: "granted" } };
    }
    try {
      const before = systemPreferences.getMediaAccessStatus(media);
      if (before !== "granted") {
        await systemPreferences.askForMediaAccess(media);
      }
      const status = systemPreferences.getMediaAccessStatus(media);
      console.log(`[electron] media access ${media}: ${before} → ${status}`);
      return { ok: true, value: { status } };
    } catch (err) {
      return { ok: false, code: "unknown", message: err instanceof Error ? err.message : String(err) };
    }
  });
}
