// Shell preload (phase 2: full bridge). Plain CJS: the sandboxed preload
// context only guarantees require("electron") — no ESM loader, no stripping.
//
// Two surfaces:
//  - invoke(channel, req): contract channels ONLY (allowlisted below).
//    Every result is an IpcResult envelope (never throws across the bridge).
//  - Named methods for shell-local channels (decide/transcript/transcribe/
//    preview/guest): deliberately NOT a generic invoke — the allowlist stays
//    auditable in one place.
//  - onEvent(channel, fn): the three contract event channels only.
//
// NOTE: the page also sets `window.mhacks` (renderer.js debug handle). This
// uses the distinct name `mhacksNative` so the two can never clobber each
// other in either direction.
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// Mirrors InvokeChannel (contracts) minus speech:start (wrapped main-side,
// same name). Anything else is rejected here, before IPC.
const INVOKE_ALLOWLIST = new Set([
  "preview:queryElementAt",
  "preview:setCalibration",
  "agent:submitEdit",
  "git:createSnapshot",
  "git:undo",
  "git:confirm",
  "git:history",
  "speech:start",
  "speech:stop",
]);

const EVENT_ALLOWLIST = new Set(["pipeline:state", "speech:transcript", "speech:state"]);

contextBridge.exposeInMainWorld("mhacksNative", {
  isElectron: () => true,
  versions: () => ({
    electron: (process.versions && process.versions.electron) || "unknown",
    chrome: (process.versions && process.versions.chrome) || "unknown",
  }),

  invoke: (channel, req) => {
    if (!INVOKE_ALLOWLIST.has(channel)) {
      return Promise.resolve({
        ok: false,
        code: "unknown",
        message: `blocked channel ${String(channel)}`,
      });
    }
    return ipcRenderer.invoke(channel, req);
  },

  // Full utterance pipeline (mirrors POST /api/decide-and-edit {status,body}).
  decideAndEdit: (body) => ipcRenderer.invoke("pipeline:decideAndEdit", body),

  // Recognizer text into the shell state machine (fire-and-forget welcome).
  pushTranscript: (text, isFinal) =>
    ipcRenderer.invoke("speech:pushTranscript", { text, isFinal }),

  // Scribe fallback: ArrayBuffer/Uint8Array audio → envelope with text.
  transcribeAudio: (audio, mimeType) =>
    ipcRenderer.invoke("speech:transcribe", { audio, mimeType }),

  // Regenerate the data: URL preview (apply/undo + startup handshake).
  reloadPreview: () => ipcRenderer.invoke("preview:reload"),

  // Guest preload file URL (dev: repo file; packaged: extraResources).
  guestPreloadURL: () =>
    ipcRenderer.invoke("shell:guestPreload").then((r) => (r && r.ok ? r.value.url : "")),

  // OS camera/mic prompt (macOS TCC). Resolve with the status string
  // ("granted" | "denied" | "restricted" | "unknown").
  ensureMediaAccess: (kind) => ipcRenderer.invoke("shell:ensureMediaAccess", kind),

  onEvent: (channel, fn) => {
    if (!EVENT_ALLOWLIST.has(channel)) throw new Error(`blocked event ${String(channel)}`);
    const listener = (_event, payload) => {
      try {
        fn(payload);
      } catch {
        // Renderer handler errors must never break the bridge.
      }
    };
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});

// Frameless-shell marker for page CSS: headers opt into
// -webkit-app-region drag only inside the Electron window (the native title
// bar is hidden there — see main titleBarStyle). Set IMMEDIATELY only for
// the desktop shell page (identified by its #preview-webview element, which
// no frontend page has). Frontend pages MUST skip this: an imperative
// pre-hydration attribute on <html> trips React's hydration-mismatch overlay
// (SSR HTML lacks it). Their RootLayout mounts <ElectronShell /> instead,
// which sets the same attribute in an effect (post-hydration = invisible to
// the check).
window.addEventListener(
  "DOMContentLoaded",
  () => {
    try {
      if (document.querySelector("#preview-webview")) {
        document.documentElement.setAttribute("data-electron-shell", "");
      }
    } catch {
      // Marker is cosmetic (drag regions); never break the page for it.
    }
  },
  { once: true },
);
