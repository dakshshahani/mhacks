import { FaceLandmarker, FilesetResolver } from "../../node_modules/@mediapipe/tasks-vision/vision_bundle.mjs";

// Relative so the page loads identically over http://localhost (harness)
// and file:// (packaged shell) — absolute /node_modules only resolves
// against a server root.
const WASM_ROOT = "../../node_modules/@mediapipe/tasks-vision/wasm";
const DEFAULT_MODEL_PATH = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function headPoseFromLandmarks(faceLandmarks = []) {
  if (!Array.isArray(faceLandmarks) || faceLandmarks.length === 0) return null;
  const valid = faceLandmarks.filter((landmark) => landmark && Number.isFinite(landmark.x) && Number.isFinite(landmark.y));
  if (valid.length === 0) return null;
  const nose = faceLandmarks[1] && Number.isFinite(faceLandmarks[1].x)
    ? faceLandmarks[1]
    : {
        x: valid.reduce((sum, landmark) => sum + landmark.x, 0) / valid.length,
        y: valid.reduce((sum, landmark) => sum + landmark.y, 0) / valid.length,
      };
  const xs = valid.map((landmark) => landmark.x);
  const ys = valid.map((landmark) => landmark.y);
  return {
    x: clamp(nose.x, 0, 1),
    y: clamp(nose.y, 0, 1),
    faceWidth: clamp(Math.max(...xs) - Math.min(...xs), 0, 1),
    faceHeight: clamp(Math.max(...ys) - Math.min(...ys), 0, 1),
  };
}

export function startHeadTracking(onPose, { modelAssetPath = DEFAULT_MODEL_PATH, onError } = {}) {
  let active = true;
  let animationFrame = null;
  let stream = null;
  let video = null;
  let landmarker = null;
  let lastVideoTime = -1;
  let previousTimestamp = 0;
  let detectFailures = 0;

  function fail(message) {
    // Fatal tracking fault: release everything (camera light off, honest
    // state) and report once through onError. The status line previously
    // sat at "starting…" forever here — light on, zero poses, zero signal.
    active = false;
    if (animationFrame) window.cancelAnimationFrame(animationFrame);
    animationFrame = null;
    try {
      landmarker?.close();
    } catch {
      // Already closed.
    }
    try {
      stream?.getTracks().forEach((track) => track.stop());
    } catch {
      // Already stopped.
    }
    try {
      video?.remove();
    } catch {
      // Already detached.
    }
    landmarker = null;
    stream = null;
    video = null;
    try {
      onError?.(message);
    } catch {
      // Status reporting must never break teardown.
    }
    throw new Error(message);
  }

  /** Rejects when `work` doesn't settle in time (play() can pend forever
   *  under autoplay blocks; frames can stall with a live track when the OS
   *  holds the camera). Turns "starting…" forever into a named failure. */
  function withStallTimeout(work, ms, message) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(message));
      }, ms);
      Promise.resolve()
        .then(work)
        .then(
          (value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(value);
          },
          (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(err);
          },
        );
    });
  }

  const ready = (async () => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("camera API unavailable");
    const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
    landmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath },
      runningMode: "VIDEO",
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
      audio: false,
    });
    if (!active) return;
    video = document.createElement("video");
    video.dataset.headTrackingVideo = "true";
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    Object.assign(video.style, { position: "fixed", width: "1px", height: "1px", opacity: "0", pointerEvents: "none" });
    document.body.append(video);
    video.srcObject = stream;
    try {
      await withStallTimeout(
        () => video.play(),
        8000,
        "camera playback never started — the browser may be blocking autoplay",
      );
      await withStallTimeout(async () => {
        while (active && video.readyState < 2) {
          await new Promise((r) => setTimeout(r, 250));
        }
      }, 8000, "camera stream has no frames — another app may be holding the camera");
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
    if (!active) return;

    const tick = () => {
      if (!active) return;
      if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        const timestamp = Math.max(performance.now(), previousTimestamp + 1);
        let result = null;
        try {
          result = landmarker.detectForVideo(video, timestamp);
          detectFailures = 0;
        } catch (err) {
          detectFailures += 1;
          if (detectFailures >= 10) {
            fail(`face detection failed repeatedly (${err instanceof Error ? err.message : String(err)})`);
            return;
          }
        }
        if (result) {
          const headPose = headPoseFromLandmarks(result.faceLandmarks?.[0]);
          previousTimestamp = timestamp;
          lastVideoTime = video.currentTime;
          onPose?.(headPose, { trackedConfidence: headPose ? 1 : 0 });
        }
      }
      animationFrame = window.requestAnimationFrame(tick);
    };
    tick();
  })();

  return {
    ready,
    stop() {
      active = false;
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      landmarker?.close();
      stream?.getTracks().forEach((track) => track.stop());
      video?.remove();
      animationFrame = null;
      landmarker = null;
      stream = null;
      video = null;
    },
  };
}
