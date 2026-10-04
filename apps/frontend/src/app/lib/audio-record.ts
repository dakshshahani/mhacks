/* Parallel mic capture for the Scribe fallback (ElevenLabs via
 *  POST /api/transcribe). Mirrors the proven workspace pattern
 *  (apps/desktop/src/renderer.js: startRecorder/stopRecorder/transcribeAudio):
 *  recording runs alongside browser speech from the moment listening starts
 *  and is consumed ONLY when speech produced no transcript (network-killed
 *  recognizer). The ElevenLabs key stays server-side — the page posts raw
 *  audio and gets text. */

const PREFERRED_MIMES = ["audio/webm", "audio/mp4"];

export interface AudioCapture {
  /** Stop and resolve the utterance (null when unusable). Never rejects. */
  stop: () => Promise<Blob | null>;
  /** Stop and drop everything (submit path / unmount). */
  discard: () => void;
  /** Setup failure reason, for the "captured nothing" diagnosis line. */
  error: string | null;
}

/** Best-effort parallel capture. Resolves null (with error set) instead of
 *  throwing — a dead recorder must never break the speech/typed paths. */
export async function startAudioCapture(): Promise<AudioCapture> {
  const fail = (error: string): AudioCapture => ({
    stop: () => Promise.resolve(null),
    discard: () => {},
    error,
  });
  try {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      return fail("no MediaRecorder/getUserMedia in this browser");
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    let mime = "";
    try {
      mime =
        PREFERRED_MIMES.find((m) => {
          try {
            return MediaRecorder.isTypeSupported(m);
          } catch {
            return false;
          }
        }) ?? "";
    } catch {
      mime = "";
    }
    const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    const mimeType = rec.mimeType || mime || "audio/webm";
    let chunks: BlobPart[] = [];
    rec.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };
    const stopTracks = () => {
      try {
        stream.getTracks().forEach((track) => track.stop());
      } catch {
        // Already stopped.
      }
    };
    rec.start(250);
    let stopped = false;
    return {
      error: null,
      stop: () =>
        new Promise((resolve) => {
          const finish = () => {
            const blob =
              chunks.length > 0 ? new Blob(chunks, { type: mimeType }) : null;
            chunks = [];
            stopTracks();
            resolve(blob && blob.size > 0 ? blob : null);
          };
          if (stopped || rec.state === "inactive") {
            finish();
            return;
          }
          stopped = true;
          let settled = false;
          const once = () => {
            if (settled) return;
            settled = true;
            finish();
          };
          try {
            rec.onstop = once;
            rec.stop();
            window.setTimeout(once, 1500); // never strand on a stuck encoder
          } catch {
            once();
          }
        }),
      discard: () => {
        stopped = true;
        chunks = [];
        try {
          if (rec.state !== "inactive") rec.stop();
        } catch {
          // Already stopped.
        }
        stopTracks();
      },
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

/** POST recorded audio to the harness transcriber. Resolves the transcript
 *  (possibly empty — caller decides); throws with the harness message. */
export async function transcribeAudio(blob: Blob): Promise<string> {
  const res = await fetch("/api/transcribe", {
    method: "POST",
    headers: { "Content-Type": blob.type || "audio/webm" },
    body: blob,
  });
  const body = (await res.json()) as { ok: boolean; value?: { text?: string } } & {
    message?: string;
    code?: string;
  };
  if (!body.ok) throw new Error(body.message ?? body.code ?? "transcribe failed");
  return body.value?.text ?? "";
}
