import { FaceLandmarker, FilesetResolver } from "/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs";

const WASM_ROOT = "/node_modules/@mediapipe/tasks-vision/wasm";
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

export function startHeadTracking(onPose, { modelAssetPath = DEFAULT_MODEL_PATH } = {}) {
  let active = true;
  let animationFrame = null;
  let stream = null;
  let video = null;
  let landmarker = null;
  let lastVideoTime = -1;
  let previousTimestamp = 0;

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
    await video.play();

    const tick = () => {
      if (!active) return;
      if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        const timestamp = Math.max(performance.now(), previousTimestamp + 1);
        const result = landmarker.detectForVideo(video, timestamp);
        const headPose = headPoseFromLandmarks(result.faceLandmarks?.[0]);
        previousTimestamp = timestamp;
        lastVideoTime = video.currentTime;
        onPose?.(headPose, { trackedConfidence: headPose ? 1 : 0 });
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
