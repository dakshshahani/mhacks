// ElevenLabs Scribe fallback (dev-c.md §5.6). The renderer posts raw mic
// audio over IPC; the KEY never leaves main — the page only ever sees
// transcript text back. Ported from dev-server.mjs (same endpoint, model,
// caps); the harness copy stays for browser dev.

import type { IpcResult } from "@mhacks/contracts";
import { getElevenLabsKey } from "./envKey";

const SCRIBE_ENDPOINT = "https://api.elevenlabs.io/v1/speech-to-text";
const SCRIBE_MODEL = "scribe_v2";
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

export async function transcribeWithScribe(
  audio: Uint8Array,
  mimeType: string,
): Promise<IpcResult<{ text: string }>> {
  const apiKey = getElevenLabsKey();
  if (apiKey.length === 0) {
    return { ok: false, code: "not-ready", message: "no ElevenLabs key (speech fallback unavailable)" };
  }
  if (audio.length === 0) {
    return { ok: false, code: "unknown", message: "empty audio" };
  }
  if (audio.length > MAX_AUDIO_BYTES) {
    return { ok: false, code: "unknown", message: "audio too large (>10MB)" };
  }
  const form = new FormData();
  form.append("model_id", SCRIBE_MODEL);
  form.append(
    "file",
    new Blob([audio as BlobPart], { type: mimeType || "audio/webm" }),
    `utterance.${(mimeType || "").includes("wav") ? "wav" : "webm"}`,
  );
  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(SCRIBE_ENDPOINT, {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: form,
      signal: AbortSignal.timeout(60000),
    });
  } catch (err) {
    return { ok: false, code: "unknown", message: `scribe unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!res.ok) {
    const detail = await res.text().then((t) => t.slice(0, 300)).catch(() => "");
    return { ok: false, code: "unknown", message: `scribe ${res.status}${detail ? `: ${detail}` : ""}` };
  }
  const body = (await res.json()) as { text?: unknown };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  console.log(`[stt] ${audio.length} bytes ${mimeType} -> ${JSON.stringify(text.slice(0, 80))} (${Date.now() - t0}ms)`);
  return { ok: true, value: { text } };
}
