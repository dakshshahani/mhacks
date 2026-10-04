// Preview embed adapter (renderer side). Harness = <iframe> (probe posts to
// parent = this page). Electron shell = <webview> with main-driven content
// (data: URL via the preview:reload handshake; probe posts to parent = the
// guest window, forwarded by src/guest/preview-preload.js via sendToHost).
// Geometry consumers (gaze controller) take either through the facade.

import { isShell, shellGuestPreloadURL, shellReloadPreview } from "./transport.js";

/** True only inside the Electron shell with a live webview element. */
export function isElectronShell() {
  return isShell();
}

export function isWebviewElement(el) {
  return !!el && typeof el.send === "function" && typeof el.loadURL === "function";
}

/** Show the webview (hiding the iframe). Content is main-driven in shell
 *  mode (no src — set by the preview:reload handshake); the harness sets
 *  the iframe src here (no markup src: a file:// shell would fail the
 *  absolute path noisily before JS runs). Returns the webview element, or
 *  null on the harness. */
export function ensureElectronPreview() {
  const iframe = document.querySelector("#preview");
  const webview = document.querySelector("#preview-webview");
  if (!isShell() || !isWebviewElement(webview)) {
    // Harness: the webview is an inert unknown element; the iframe rules.
    if (iframe && !iframe.src) {
      try {
        iframe.src = "/demo/preview.html";
      } catch {
        // Assignment failing leaves a blank preview, never a crash.
      }
    }
    return null;
  }
  try {
    webview.removeAttribute("src");
  } catch {
    // Already src-less.
  }
  webview.style.display = "block";
  if (iframe) {
    iframe.style.display = "none";
    // Park the harness iframe on about:blank: under file:// its markup src
    // (/demo/preview.html) would otherwise fail noisily on every shell boot.
    try {
      iframe.src = "about:blank";
    } catch {
      // Parser already committed; the failed load is cosmetic.
    }
  }
  return webview;
}

/** Shell startup handshake: set the guest preload, kick off guest creation
 *  with about:blank, then ask main to load the generated preview. A src-less
 *  webview creates no guest WebContents — without the blank navigation main
 *  would pend its data: URL load forever (and vice versa). Main also pends
 *  until the guest exists, so either order is race-free. */
export async function initShellPreview(webview) {
  if (!webview || !isShell()) return;
  const url = await shellGuestPreloadURL();
  if (url) {
    try {
      webview.setAttribute("preload", url);
    } catch {
      // Guest runs probeless: clicks still focus, probe queries wv-gone.
    }
  }
  try {
    webview.src = "about:blank";
  } catch {
    // Navigation failed; main's pended load still covers the first paint.
  }
  await shellReloadPreview();
}

/** Shell preview refresh (post-apply/undo): main regenerates the data: URL.
 *  Harness keeps the cache-busting loadURL swap. */
export async function refreshShellPreview(webview) {
  if (webview && isShell()) {
    await shellReloadPreview();
    return true;
  }
  return false;
}

/** Minimal iframe-shaped facade over a <webview> for the gaze controller:
 *  contentWindow.postMessage (→ guest via sendToHost bridge), bounding rect,
 *  and load-listener mapping (webview speaks did-finish-load). Everything
 *  else (contentDocument) is intentionally absent — controller falls back to
 *  element dimensions, per its webview comment. */
export function webviewFacade(webview) {
  return {
    contentWindow: {
      postMessage: (message) => {
        try {
          webview.send("gaze-query-in", message);
        } catch {
          // Dying guest — the pump's flight watchdog recovers.
        }
      },
    },
    getBoundingClientRect: () => webview.getBoundingClientRect(),
    get clientWidth() {
      return webview.clientWidth;
    },
    get clientHeight() {
      return webview.clientHeight;
    },
    addEventListener: (type, listener) =>
      webview.addEventListener(type === "load" ? "did-finish-load" : type, listener),
    removeEventListener: (type, listener) =>
      webview.removeEventListener(type === "load" ? "did-finish-load" : type, listener),
  };
}

/** Harness-only cache-busting reload (shell refresh goes through main). */
export function reloadWebview(webview) {
  const base = (webview.src || webview.getURL?.() || "").split("?")[0];
  if (!base) {
    try {
      webview.reload();
    } catch {
      // Detached — leave the pixels alone.
    }
    return;
  }
  try {
    void webview.loadURL(`${base}?t=${Date.now()}`);
  } catch {
    try {
      webview.reload();
    } catch {
      // Detached — leave the pixels alone.
    }
  }
}
