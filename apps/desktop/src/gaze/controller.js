import { startHeadTracking } from "./headLandmarker.js";
import { createHeadCursor, DEFAULT_HEAD_TRACKING } from "./headCursor.js";
import { createEmaSmoother } from "./smoothing.js";
import { createTargetStabilizer } from "./stabilizer.js";
import { createDwellTracker } from "./dwell.js";

const DEFAULT_SETTINGS = Object.freeze({
  dwellMs: 500,
  smoothing: 0.25,
  minRadiusPx: 90,
  maxRadiusPx: 160,
  headTracking: DEFAULT_HEAD_TRACKING,
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeSettings(value = {}) {
  const minRadiusPx = Number.isFinite(value.minRadiusPx) ? Math.max(0, value.minRadiusPx) : DEFAULT_SETTINGS.minRadiusPx;
  return {
    dwellMs: clamp(Number.isFinite(value.dwellMs) ? value.dwellMs : DEFAULT_SETTINGS.dwellMs, 300, 600),
    smoothing: clamp(Number.isFinite(value.smoothing) ? value.smoothing : DEFAULT_SETTINGS.smoothing, 0.05, 0.8),
    minRadiusPx,
    maxRadiusPx: Number.isFinite(value.maxRadiusPx) ? Math.max(minRadiusPx, value.maxRadiusPx) : DEFAULT_SETTINGS.maxRadiusPx,
    headTracking: value.headTracking ?? DEFAULT_SETTINGS.headTracking,
  };
}

function radiusForConfidence(confidence, settings) {
  const c = clamp(Number.isFinite(confidence) ? confidence : 0, 0, 1);
  return Math.round(settings.maxRadiusPx - c * (settings.maxRadiusPx - settings.minRadiusPx));
}

function candidateAt(frame, id) {
  return frame?.candidates?.find((candidate) => candidate.id === id) ?? null;
}

function lockedFrame(frame, id) {
  const target = candidateAt(frame, id);
  return target ? { ...frame, lockedTarget: target } : { ...frame, lockedTarget: null };
}

function rectToHost(rect, iframeRect, contentWidth, contentHeight) {
  const scaleX = iframeRect.width > 0 && contentWidth > 0 ? iframeRect.width / contentWidth : 1;
  const scaleY = iframeRect.height > 0 && contentHeight > 0 ? iframeRect.height / contentHeight : 1;
  return {
    x: iframeRect.left + rect.x * scaleX,
    y: iframeRect.top + rect.y * scaleY,
    width: rect.width * scaleX,
    height: rect.height * scaleY,
  };
}

function previewMetrics(iframe) {
  const iframeRect = iframe.getBoundingClientRect();
  let contentWidth = iframe.clientWidth || iframeRect.width;
  let contentHeight = iframe.clientHeight || iframeRect.height;
  try {
    contentWidth = iframe.contentDocument?.documentElement?.clientWidth || contentWidth;
    contentHeight = iframe.contentDocument?.documentElement?.clientHeight || contentHeight;
  } catch {
    // A future Electron webview may not expose contentDocument. The rendered
    // iframe dimensions are still a useful scale fallback.
  }
  return { iframeRect, contentWidth, contentHeight };
}

function createOverlay() {
  const layer = document.createElement("div");
  layer.dataset.gazeOverlay = "true";
  Object.assign(layer.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483646",
    pointerEvents: "none",
  });
  // Pointer rendering lives in the frontend gaze blob (apps/frontend blob.tsx
  // + lib/blob-input.ts): this overlay draws candidate outlines only, never a
  // cursor. The old orb/raw-dot pointer markers were removed when the blob
  // replaced them — one cursor on screen, owned in one place.
  const outlines = new Map();
  document.body.append(layer);

  return {
    update({ candidates, lockedId, primaryId }) {
      const visible = new Set(candidates.map((candidate) => candidate.id));
      for (const [id, node] of outlines) {
        if (!visible.has(id)) {
          node.remove();
          outlines.delete(id);
        }
      }
      candidates.forEach((candidate, index) => {
        let node = outlines.get(candidate.id);
        if (!node) {
          node = document.createElement("div");
          node.dataset.gazeOverlay = "true";
          outlines.set(candidate.id, node);
          layer.append(node);
        }
        const primary = candidate.id === primaryId || candidate.id === lockedId || (index === 0 && !primaryId);
        Object.assign(node.style, {
          position: "fixed",
          left: `${candidate.boundingRect.x}px`,
          top: `${candidate.boundingRect.y}px`,
          width: `${candidate.boundingRect.width}px`,
          height: `${candidate.boundingRect.height}px`,
          border: `${primary ? 2 : 1}px ${primary ? "solid" : "dashed"} ${candidate.id === lockedId ? "#f8bd46" : primary ? "#5ae0e7" : "#b864ff"}`,
          borderRadius: "6px",
          boxSizing: "border-box",
          display: "block",
        });
      });
    },
    remove() {
      layer.remove();
    },
    clear() {
      for (const [, node] of outlines) node.remove();
      outlines.clear();
    },
  };
}

/** Host-side head tracker. Preview DOM inspection stays in the injected probe. */
export function createGazeController({
  getPreview = () => document.querySelector("#preview"),
  settings = DEFAULT_SETTINGS,
  onFrame = () => {},
  onStatus = () => {},
  onInvalidate = () => {},
} = {}) {
  const config = normalizeSettings(settings);
  const cursor = createHeadCursor(config.headTracking);
  const smoother = createEmaSmoother(config.smoothing);
  const stabilizer = createTargetStabilizer(2);
  const dwell = createDwellTracker(config.dwellMs);
  const overlay = createOverlay();
  let tracker = null;
  let animationFrame = null;
  let mounted = false;
  let listening = false;
  let latestPose = null;
  let latestCursor = null;
  let latestFrame = null;
  let stableId = null;
  let lockedId = null;
  let manualLock = false;
  let requestSerial = 0;
  let requestInFlight = false;
  let inFlightAt = 0;
  const FLIGHT_TIMEOUT_MS = 750;
  let queuedRequest = null;
  let lastSelectionAt = Number.NEGATIVE_INFINITY;
  const selectionIntervalMs = 1000 / 24;
  // Scroll/reload invalidation: probe rects are viewport-relative and ids are
  // positional, so any preview scroll or document swap voids learned state.
  let boundIframe = null;
  let boundDoc = null;
  let lastInvalidatedAt = Number.NEGATIVE_INFINITY;
  const INVALIDATE_THROTTLE_MS = 100;

  function hostCandidates(frame, metrics) {
    return (frame?.candidates ?? []).map((candidate) => ({
      ...candidate,
      boundingRect: rectToHost(candidate.boundingRect, metrics.iframeRect, metrics.contentWidth, metrics.contentHeight),
    }));
  }

  /** The preview moved under us (scroll) or was swapped (reload/nav):
   *  drop everything learned from the old viewport so fresh probes relearn
   *  within a frame or two instead of freezing on stale geometry. */
  function invalidateGaze() {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (now - lastInvalidatedAt < INVALIDATE_THROTTLE_MS) return;
    lastInvalidatedAt = now;
    latestFrame = null;
    stableId = null;
    lockedId = null;
    manualLock = false;
    stabilizer.reset();
    dwell.reset();
    requestInFlight = false;
    queuedRequest = null;
    overlay.clear();
    try {
      onInvalidate();
    } catch {
      // Host notification must never break the pump.
    }
  }

  function previewDoc(iframe) {
    try {
      return iframe?.contentDocument ?? null;
    } catch {
      // Cross-origin preview: no scroll visibility, probes still answer.
      return null;
    }
  }

  function onPreviewScroll() {
    invalidateGaze();
  }

  function onPreviewLoad() {
    // New document: old scroll listener died with it; re-attach below and
    // void any flight answered by the previous document (its response can
    // never arrive, and must not wedge the pump).
    boundDoc = null;
    invalidateGaze();
    bindPreview(getPreview());
  }

  function bindPreview(iframe) {
    if (iframe === boundIframe && boundDoc) return;
    if (boundIframe) boundIframe.removeEventListener("load", onPreviewLoad);
    if (boundDoc) boundDoc.removeEventListener("scroll", onPreviewScroll, true);
    boundIframe = iframe ?? null;
    boundDoc = null;
    if (!boundIframe) return;
    boundIframe.addEventListener("load", onPreviewLoad);
    const doc = previewDoc(boundIframe);
    if (doc) {
      // Capture phase: inner scrollers bubble through the document.
      doc.addEventListener("scroll", onPreviewScroll, { capture: true, passive: true });
      boundDoc = doc;
    }
  }

  /** Watchdog: a probe answered by a dying document never resolves, and
   *  without this the pump wedges with requestInFlight stuck true forever. */
  function checkFlight() {
    if (!requestInFlight) return;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (now - inFlightAt >= FLIGHT_TIMEOUT_MS) requestInFlight = false;
  }

  function sendProbe(point, radiusPx) {
    const iframe = getPreview();
    if (!iframe?.contentWindow) return;
    const metrics = previewMetrics(iframe);
    if (metrics.iframeRect.width <= 0 || metrics.iframeRect.height <= 0) return;
    const x = (point.x - metrics.iframeRect.left) * metrics.contentWidth / metrics.iframeRect.width;
    const y = (point.y - metrics.iframeRect.top) * metrics.contentHeight / metrics.iframeRect.height;
    if (x < 0 || y < 0 || x > metrics.contentWidth || y > metrics.contentHeight) return;
    const request = { requestId: `g${++requestSerial}`, x, y, radiusPx, metrics };
    if (requestInFlight) {
      queuedRequest = request;
      return;
    }
    requestInFlight = true;
    inFlightAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    iframe.contentWindow.postMessage({ type: "gaze-query", requestId: request.requestId, x, y, radiusPx }, "*");
  }

  function acceptFrame(frame, previewPoint = null, hostPoint = null) {
    if (!frame || !Array.isArray(frame.candidates)) return;
    latestFrame = frame;
    const iframe = getPreview();
    if (!iframe) return;
    const metrics = previewMetrics(iframe);
    const mappedCandidates = hostCandidates(frame, metrics);
    const target = frame.lockedTarget ?? frame.candidates.at(-1) ?? frame.candidates[0] ?? null;
    if (!listening) {
      const next = stabilizer.update(target?.id ?? null);
      stableId = next.id;
      const dwellState = dwell.update(stableId, performance.now());
      if (dwellState.lockedId) lockedId = dwellState.lockedId;
      if (next.changed && lockedId && lockedId !== stableId) lockedId = null;
    }
    const effectiveId = lockedId ?? stableId;
    const effectiveFrame = effectiveId ? lockedFrame(frame, effectiveId) : frame;
    const effectiveCandidates = hostCandidates(effectiveFrame, metrics);
    overlay.update({
      rawPoint: hostPoint ?? latestCursor?.rawPoint ?? { x: 0, y: 0 },
      point: hostPoint ?? latestCursor?.point ?? { x: 0, y: 0 },
      radiusPx: latestCursor?.radiusPx ?? 0,
      candidates: effectiveCandidates,
      lockedId: effectiveId,
      primaryId: effectiveFrame.lockedTarget?.id ?? stableId,
    });
    onFrame({
      frame: effectiveFrame,
      previewPoint,
      hostPoint,
      hostCandidates: effectiveCandidates,
    });
  }

  function receiveReply(message) {
    requestInFlight = false;
    acceptFrame(message.frame, { x: message.x, y: message.y }, latestCursor?.point ?? null);
    if (queuedRequest) {
      const next = queuedRequest;
      queuedRequest = null;
      const target = getPreview();
      target?.contentWindow?.postMessage({ type: "gaze-query", requestId: next.requestId, x: next.x, y: next.y, radiusPx: next.radiusPx }, "*");
      requestInFlight = true;
      inFlightAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    }
  }

  function handleProbeMessage(event) {
    const message = event.data;
    if (!message || message.type !== "preview-gaze-frame") return;
    const iframe = getPreview();
    if (!iframe || event.source !== iframe.contentWindow) return;
    receiveReply(message);
  }

  /** Electron shell path: the preview webview's guest bridge delivers query
   *  replies via sendToHost (no forgeable MessageEvent source exists there),
   *  already scoped to our own webview by the renderer's ipc-message wiring.
   *  Same pump state machine as the iframe path. */
  function acceptProbeReply(message) {
    if (!message || !message.frame) return;
    receiveReply(message);
  }

  function processFrame() {
    if (!mounted) return;
    checkFlight();
    const preview = getPreview();
    if (preview !== boundIframe) bindPreview(preview);
    if (latestPose) {
      const mapped = cursor.map(latestPose, { width: window.innerWidth, height: window.innerHeight });
      if (mapped) {
        const point = smoother.update(mapped.point) ?? mapped.point;
        const trackedConfidence = latestPose ? 1 : 0;
        const radiusPx = radiusForConfidence(trackedConfidence, config);
        latestCursor = { rawPoint: mapped.rawPoint, point, radiusPx };
        // Follow gaze whenever nothing is frozen: a latched manual lock or a
        // locked mid-utterance target freezes the highlight for editing, but
        // mic-on with no lock yet (pre-target speech) keeps following — the
        // mic-start transition locks the stabilized target when one exists.
        const frozen = manualLock || (listening && lockedId !== null);
        if (!frozen && performance.now() - lastSelectionAt >= selectionIntervalMs) {
          lastSelectionAt = performance.now();
          sendProbe(point, radiusPx);
        }
        const candidates = latestFrame && preview
          ? hostCandidates(latestFrame, previewMetrics(preview))
          : [];
        overlay.update({
          candidates,
          lockedId,
          primaryId: latestFrame?.lockedTarget?.id ?? stableId,
        });
      }
    }
    animationFrame = window.requestAnimationFrame(processFrame);
  }

  function setSpeechState(state) {
    const nextListening = state === "listening" || state === "processing";
    if (nextListening && !listening) {
      const target = latestFrame?.lockedTarget ?? candidateAt(latestFrame, stableId) ?? latestFrame?.candidates?.[0] ?? null;
      lockedId = target?.id ?? null;
      if (lockedId && latestFrame) acceptFrame(latestFrame, null, latestCursor?.point ?? null);
    }
    if (!nextListening && listening) {
      lockedId = null;
      stableId = null;
      manualLock = false;
      stabilizer.reset();
      dwell.reset();
    }
    listening = nextListening;
  }

  function start() {
    if (mounted) return;
    mounted = true;
    window.addEventListener("message", handleProbeMessage);
    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("visibilitychange", handleVisibility);
    bindPreview(getPreview());
    onStatus("starting head tracking…");
    tracker = startHeadTracking(
      (pose) => {
        latestPose = pose;
        if (pose) onStatus("head tracking active · press R to recenter");
      },
      {
        onError: (message) => {
          // Fatal tracker fault (stall watchdog / repeated detect failures):
          // teardown already ran inside, camera released. Surface the
          // specific cause — the previous "starting…" forever told nothing.
          onStatus(`head tracking stopped: ${message}`);
        },
      },
    );
    tracker.ready.catch((error) => {
      // Setup-phase failure (no camera API, denied prompt, stalled stream):
      // fail() already tore down, but stop() again is idempotent-safe.
      // Releases the camera so the light goes off instead of lingering.
      try {
        tracker?.stop();
      } catch {
        // Teardown must never break status reporting.
      }
      onStatus(`camera unavailable: ${error?.message ?? "permission denied"}`);
    });
    animationFrame = window.requestAnimationFrame(processFrame);
  }

  function recenter() {
    const centered = cursor.recenter(latestPose, { width: window.innerWidth, height: window.innerHeight });
    if (!centered) {
      onStatus("head tracking · no face to recenter");
      return;
    }
    stableId = null;
    lockedId = null;
    manualLock = false;
    latestFrame = null;
    stabilizer.reset();
    dwell.reset();
    onStatus("head tracking · recentered");
  }

  function acceptExternalFrame(frame, previewPoint) {
    stabilizer.click(frame?.lockedTarget?.id ?? frame?.candidates?.at(-1)?.id ?? frame?.candidates?.[0]?.id ?? null);
    stableId = stabilizer.getStableId();
    lockedId = stableId;
    manualLock = Boolean(lockedId);
    let hostPoint = latestCursor?.point ?? null;
    const iframe = getPreview();
    if (iframe && previewPoint) {
      const metrics = previewMetrics(iframe);
      hostPoint = {
        x: metrics.iframeRect.left + previewPoint.x * metrics.iframeRect.width / Math.max(1, metrics.contentWidth),
        y: metrics.iframeRect.top + previewPoint.y * metrics.iframeRect.height / Math.max(1, metrics.contentHeight),
      };
    }
    acceptFrame(frame, previewPoint, hostPoint);
  }

  function handleVisibility() {
    // rAF (the detection pump) doesn't fire while hidden — say so instead
    // of freezing on stale geometry; it resumes on its own when visible.
    if (typeof document === "undefined" || !mounted) return;
    if (document.hidden) onStatus("tracking paused — tab hidden");
    else if (latestPose) onStatus("head tracking active · press R to recenter");
  }

  function handleKeyDown(event) {
    if (event.key.toLowerCase() === "r") {
      recenter();
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && latestFrame) {
      event.preventDefault();
      const target = latestFrame.lockedTarget ?? candidateAt(latestFrame, stableId) ?? latestFrame.candidates?.[0];
      if (target) {
        lockedId = target.id;
        manualLock = true;
        acceptFrame(latestFrame, null, latestCursor?.point ?? null);
      }
    }
  }

  function stop() {
    mounted = false;
    if (animationFrame) window.cancelAnimationFrame(animationFrame);
    window.removeEventListener("message", handleProbeMessage);
    window.removeEventListener("keydown", handleKeyDown);
    try {
      document.removeEventListener("visibilitychange", handleVisibility);
    } catch {
      // Already detached.
    }
    if (boundIframe) boundIframe.removeEventListener("load", onPreviewLoad);
    if (boundDoc) boundDoc.removeEventListener("scroll", onPreviewScroll, true);
    boundIframe = null;
    boundDoc = null;
    tracker?.stop();
    tracker = null;
    overlay.remove();
  }

  return { start, stop, setSpeechState, recenter, acceptExternalFrame, acceptProbeReply };
}
