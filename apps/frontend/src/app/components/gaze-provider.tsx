'use client';

/* Gaze provider: head-tracking sensor for every page. Webcam nose/micro-
 * head-pose → viewport gaze point, published at window.__gazePoint for the
 * blob (see lib/blob-input.ts; blob prefers fresh gaze, else the mouse).
 *
 * This is the SENSOR only: no visuals, no dwell, no clicks. Dwell-locking
 * and disambiguation stay in the desktop gaze controller; the blob only
 * renders. Math mirrors apps/desktop/src/gaze/headCursor.js (gains 2.5/3,
 * EMA smoothing) — mirrored, never imported, per AGENTS.md seams.
 *
 * Silent when the camera is unavailable or denied: the blob falls back to
 * the mouse and nothing renders. Mounted once in layout.tsx. */

import { useEffect } from "react";
import { RECENTER_EVENT } from "../lib/blob-input";

const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL_PATH =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
// Mirrors DEFAULT_HEAD_TRACKING (desktop gaze): mirrored selfie axis.
const GAIN_X = 2.5;
const GAIN_Y = 3;
const SMOOTHING = 0.25;

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

export default function GazeProvider() {
  useEffect(() => {
    // MediaPipe's WASM backend logs a benign XNNPACK INFO line through
    // console.error, which the Next dev overlay escalates — drop that line.
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      if (/xnnpack|tensorflow lite/i.test(String(args[0] ?? ""))) return;
      origError(...args);
    };
    let alive = true;
    let raf = 0;
    let video: HTMLVideoElement | null = null;
    let landmarker: FaceLandmarkerInstance | null = null;
    let stream: MediaStream | null = null;
    let neutral: FacePoint | null = null;
    let smooth: FacePoint | null = null;
    let lastVideoTime = -1;
    let lastNose: FacePoint | null = null;
    // R key: the head you're holding becomes the new neutral and the blob
    // snaps to viewport center. Fixes drift (neutral otherwise lives from
    // the first frame forever, so the orb roams off the true gaze).
    const recenter = () => {
      if (lastNose) neutral = { ...lastNose };
      const center = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      smooth = center;
      window.__gazePoint = { ...center, at: performance.now() };
    };
    window.addEventListener(RECENTER_EVENT, recenter);

    (async () => {
      let vision: VisionTasks;
      try {
        vision = await import("@mediapipe/tasks-vision");
      } catch {
        return; // No model runtime — mouse drives the blob.
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
        // The camera may be held by another page (harness preview holds it
        // while gaze runs there) — retry until it frees instead of failing
        // once and parking the orb forever. No prompt spam: getUserMedia
        // only prompts on user-visible pages, repeat denials stay silent.
        const acquire = async (): Promise<boolean> => {
          try {
            const s = await navigator.mediaDevices.getUserMedia({
              video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
              audio: false,
            });
            if (!alive) {
              s.getTracks().forEach((track) => track.stop());
              return false;
            }
            stream = s;
            return true;
          } catch {
            return false;
          }
        };
        while (alive && !stream) {
          if (await acquire()) break;
          await new Promise((r) => setTimeout(r, 5000));
        }
      } catch {
        return; // No model runtime — mouse drives the blob.
      }
      // Cast, don't narrow: the retry loop assigns stream inside a nested
      // closure, which TS control flow can't see (it would narrow to never).
      const live = stream as MediaStream | null;
      if (!alive || !live) return;
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
      video.srcObject = live;
      try {
        await video.play();
      } catch {
        return;
      }
      // Camera released mid-session (track ended): drop the stream so the
      // stale point expires and the mouse takes over — never freeze.
      live.getVideoTracks().forEach((track) =>
        track.addEventListener("ended", () => {
          stream = null;
        }),
      );

      const tick = () => {
        if (!alive) return;
        raf = window.requestAnimationFrame(tick);
        if (!video || !landmarker || video.readyState < 2 || video.currentTime === lastVideoTime) return;
        lastVideoTime = video.currentTime;
        let nose: FacePoint | null = null;
        try {
          const result = landmarker.detectForVideo(video, performance.now());
          const point = result.faceLandmarks?.[0]?.[1];
          if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
            nose = { x: point.x, y: point.y };
          }
        } catch {
          nose = null;
        }
        if (!nose) return; // face lost: keep last point, mouse takes over on expiry
        lastNose = nose;
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
        window.__gazePoint = { x: smooth.x, y: smooth.y, at: performance.now() };
      };
      tick();
    })();

    return () => {
      alive = false;
      console.error = origError;
      window.removeEventListener(RECENTER_EVENT, recenter);
      window.cancelAnimationFrame(raf);
      try {
        landmarker?.close();
      } catch {
        // Already closed.
      }
      stream?.getTracks().forEach((track) => track.stop());
      video?.remove();
    };
    // Mount-only: the camera loop never restarts (refs and imports only).
  }, []);

  return null;
}
