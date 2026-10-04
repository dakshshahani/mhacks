// Transport: Electron native bridge (window.mhacksNative) with harness
// fetch/SSE fallback. Same shapes both ways so renderer call sites never
// branch — they call these helpers and work in the shell and the browser.

const native = () =>
  typeof window !== "undefined" && window.mhacksNative?.invoke ? window.mhacksNative : null;

/** True inside the Electron shell (preload bridge present). */
export const isShell = () => native() !== null;

/** Contract invoke channels (IpcResult envelope either way). */
export async function invoke(channel, req, project) {
  const n = native();
  if (n) return n.invoke(channel, req);
  const res = await fetch("/api/invoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel, req, project }),
  });
  return res.json();
}

/** Full utterance (mirrors POST /api/decide-and-edit {status, body}). */
export async function decideAndEdit(body, project) {
  const n = native();
  if (n) return n.decideAndEdit(body);
  const res = await fetch("/api/decide-and-edit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, project }),
  });
  return { status: res.status, body: await res.json() };
}

/** Recognizer text into the shell state machine (fire-and-forget). */
export function pushTranscript(text, isFinal) {
  const n = native();
  if (n) {
    void n.pushTranscript(text, isFinal).catch(() => undefined);
    return;
  }
  fetch("/api/transcript", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, isFinal }),
  }).catch(() => undefined);
}

/** Scribe fallback audio upload → transcript text (key stays server-side). */
export async function transcribeAudio(blob) {
  const n = native();
  if (n) {
    const buf = await blob.arrayBuffer();
    const body = await n.transcribeAudio(buf, blob.type || "audio/webm");
    if (!body.ok) throw new Error(body.message ?? body.code ?? "transcribe failed");
    return body.value.text;
  }
  const res = await fetch("/api/transcribe", {
    method: "POST",
    headers: { "Content-Type": blob.type || "audio/webm" },
    body: blob,
  });
  const body = await res.json();
  if (!body.ok) throw new Error(body.message ?? body.code ?? "transcribe failed");
  return body.value.text;
}

/** Live event stream. Returns an unsubscribe fn. onStreamDown fires only on
 *  the harness SSE path (reconnect notice); the native bridge doesn't drop. */
export function subscribeEvents(handlers) {
  const n = native();
  if (n) {
    const offs = [
      n.onEvent("pipeline:state", (state) => handlers.onPipeline(state)),
      n.onEvent("speech:state", (state) => handlers.onSpeechState(state)),
      n.onEvent("speech:transcript", (event) => handlers.onTranscript(event)),
    ];
    return () => {
      for (const off of offs) {
        try {
          off();
        } catch {
          // Already detached.
        }
      }
    };
  }
  const events = new EventSource("/api/events");
  let alive = false;
  events.onopen = () => {
    alive = true;
  };
  events.onerror = () => {
    if (alive) {
      alive = false;
      handlers.onStreamDown?.();
    }
  };
  events.onmessage = (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    if (msg.type === "pipeline") handlers.onPipeline(msg.state);
    else if (msg.type === "speech-state") handlers.onSpeechState(msg.state);
    else if (msg.type === "speech-transcript") handlers.onTranscript(msg.event);
  };
  return () => events.close();
}

/** Ask main to (re)generate the data: URL preview. False on harness. */
export async function shellReloadPreview() {
  const n = native();
  if (!n) return false;
  await n.reloadPreview();
  return true;
}

/** Guest preload file URL for the webview attr ("" on harness). */
export async function shellGuestPreloadURL() {
  const n = native();
  if (!n) return "";
  try {
    return (await n.guestPreloadURL()) ?? "";
  } catch {
    return "";
  }
}

/** OS camera/mic prompt via main (macOS TCC). Shell-only: resolves
 *  "unknown" in the harness (browser owns the prompt there). Call BEFORE
 *  getUserMedia so a first-use deny becomes a prompt, never silent death. */
export async function ensureMediaAccess(kind) {
  const n = native();
  if (!n || typeof n.ensureMediaAccess !== "function") return "unknown";
  try {
    const body = await n.ensureMediaAccess(kind);
    return body && body.ok ? body.value.status : "unknown";
  } catch {
    return "unknown";
  }
}
