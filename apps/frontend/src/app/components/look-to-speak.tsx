'use client';

/* Look-to-speak dwell for the hero pill: webcam head pose → screen gaze
 * point → 500ms dwell inside the target rect fires onDwell (mic start).
 *
 * Frontend-owned until Dev A's gaze client covers landing (AGENTS.md seams:
 * never import another dev's source tree — so the math here mirrors
 * apps/desktop/src/gaze/ instead: invertX + gains from headCursor,
 * threshold timing from dwell, EMA smoothing, MediaPipe wiring from
 * headLandmarker). WASM + model load from pinned CDNs at runtime.
 *
 * Silent when the camera is unavailable or denied: pill click stays the
 * fallback, and nothing renders (no new visuals except the host's own
 * dwell wash, driven via onProgress). */

import { useEffect, useRef, type RefObject } from "react";

const DWELL_MS = 500;
const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL_PATH =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
// Mirrors DEFAULT_HEAD_TRACKING (desktop gaze): mirrored selfie axis.
const GAIN_X = 2.5;
const GAIN_Y = 3;
const SMOOTHING = 0.35;

interface FacePoint {
  x: number;
  y: number;
}

interface FaceLandmarkerInstance {
  detectForVideo(
    video: HTMLVideoElement,
    timestamp: number,
  ): { faceLandmarks?: ArrayLike<ArrayLike<FacePoint>> };
  close(): void;
}

interface VisionTasks {
  FaceLandmarker: {
    createFromOptions(v: unknown, o: unknown): Promise<FaceLandmarkerInstance>;
  };
  FilesetResolver: { forVisionTasks(root: string): Promise<unknown> };
}

export default function LookToSpeak({
  targetRef,
  onDwell,
  onProgress,
}: {
  /** Pill hit-box in viewport coordinates (getBoundingClientRect space). */
  targetRef: RefObject<HTMLElement | null>;
  onDwell: () => void;
  /** Dwell fill 0..1 for the host's own progress wash. */
  onProgress?: (fill: number) => void;
}) {
  const callbacks = useRef({ onDwell, onProgress });

  useEffect(() => {
    callbacks.current = { onDwell, onProgress };
  });

  useEffect(() => {
    let alive = true;
    let raf = 0;
    let video: HTMLVideoElement | null = null;
    let landmarker: FaceLandmarkerInstance | null = null;
    let stream: MediaStream | null = null;
    let rect: DOMRect | null = null;
    let neutral: FacePoint | null = null;
    let smooth: FacePoint | null = null;
    let enteredAt: number | null = null;
    let fired = false;
    let lastBucket = -1;
    let lastVideoTime = -1;

    const onResize = () => {
      rect = targetRef.current?.getBoundingClientRect() ?? null;
    };

    const emit = (fill: number) => {
      const bucket = Math.round(fill * 4);
      if (bucket !== lastBucket) {
        lastBucket = bucket;
        callbacks.current.onProgress?.(bucket / 4);
      }
    };

    (async () => {
      let vision: VisionTasks;
      try {
        vision = await import("@mediapipe/tasks-vision");
      } catch {
        return; // No model runtime — click fallback stays.
      }
      if (!alive) return;
      try {
        const fileset = await vision.FilesetResolver.forVisionTasks(WASM_ROOT);
        if (!alive) return;
        landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_PATH },
          runningMode: "VIDEO",
          numFaces: 1,
          minFaceDetectionConfidence: 0.5,
          minFacePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        if (!alive) return;
        if (!navigator.mediaDevices?.getUserMedia) return;
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
          audio: false,
        });
      } catch {
        return; // Denied or unavailable — click fallback stays.
      }
      if (!alive) return;
      video = document.createElement("video");
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      Object.assign(video.style, {
        position: "fixed",
        width: "1px",
        height: "1px",
        opacity: "0",
        pointerEvents: "none",
      });
      document.body.append(video);
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        return;
      }
      onResize();
      window.addEventListener("resize", onResize);

      const tick = () => {
        if (!alive) return;
        raf = window.requestAnimationFrame(tick);
        if (!video || !landmarker || video.readyState < 2 || video.currentTime === lastVideoTime) return;
        lastVideoTime = video.currentTime;
        let nose: FacePoint | null = null;
        try {
          const result = landmarker.detectForVideo(video, performance.now());
          const face = result.faceLandmarks?.[0];
          const point = face?.[1];
          if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
            nose = { x: point.x, y: point.y };
          }
        } catch {
          nose = null;
        }
        if (!nose || !rect) {
          enteredAt = null;
          fired = false;
          emit(0);
          return;
        }
        if (!neutral) neutral = nose;
        const gaze = {
          x: window.innerWidth / 2 - (nose.x - neutral.x) * GAIN_X * window.innerWidth,
          y: window.innerHeight / 2 + (nose.y - neutral.y) * GAIN_Y * window.innerHeight,
        };
        smooth = smooth
          ? {
              x: smooth.x + (gaze.x - smooth.x) * SMOOTHING,
              y: smooth.y + (gaze.y - smooth.y) * SMOOTHING,
            }
          : gaze;
        const inside =
          smooth.x >= rect.left &&
          smooth.x <= rect.right &&
          smooth.y >= rect.top &&
          smooth.y <= rect.bottom;
        const now = performance.now();
        if (!inside) {
          enteredAt = null;
          fired = false;
          emit(0);
          return;
        }
        enteredAt ??= now;
        const fill = Math.min(1, (now - enteredAt) / DWELL_MS);
        emit(fill);
        if (fill >= 1 && !fired) {
          fired = true;
          callbacks.current.onDwell();
        }
      };
      tick();
    })();

    return () => {
      alive = false;
      window.removeEventListener("resize", onResize);
      window.cancelAnimationFrame(raf);
      try {
        landmarker?.close();
      } catch {
        // Already closed.
      }
      stream?.getTracks().forEach((track) => track.stop());
      video?.remove();
    };
    // Mount-only: callbacks ride a ref so the camera loop never restarts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
