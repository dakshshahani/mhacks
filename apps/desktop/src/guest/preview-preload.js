// Guest preload for the preview <webview>. Plain JS with require (preload
// context) — no imports, no workspace deps.
//
// probe.js (injected into the guest page by the harness, same as the iframe
// path) posts `preview-frame` (clicks) and `preview-gaze-frame` (gaze-query
// replies) to `parent` — which inside the guest is the guest window itself,
// invisible to the embedder. This bridge forwards both out via sendToHost
// and routes embedder gaze queries back into the page.
//
// No trust here: frames are re-validated main/server-side (sanitizeFrame);
// this only moves bytes.
"use strict";

const { ipcRenderer } = require("electron");

// Embedder → page: the gaze pump's live queries.
ipcRenderer.on("gaze-query-in", (_event, msg) => {
  try {
    window.postMessage(
      {
        type: "gaze-query",
        requestId: msg && msg.requestId,
        x: msg && msg.x,
        y: msg && msg.y,
        radiusPx: msg && msg.radiusPx,
      },
      "*",
    );
  } catch {
    // Dying guest — the pump's flight watchdog recovers.
  }
});

// Page → embedder: clicks and query replies. Types are probe-owned; nothing
// else in a project page uses them, so no source check is needed (and none
// is possible across isolated worlds anyway). sendToHost never re-dispatches
// to window, so this cannot loop.
window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || (data.type !== "preview-frame" && data.type !== "preview-gaze-frame")) return;
  try {
    ipcRenderer.sendToHost(data.type, {
      x: data.x,
      y: data.y,
      frame: data.frame,
      requestId: data.requestId,
    });
  } catch {
    // Detached guest.
  }
});
