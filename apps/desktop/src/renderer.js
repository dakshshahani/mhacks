// Browser-harness client (plain JS — no TS, no imports).
// Thin client over the ipc.ts contract + the pipeline SSE stream. No decision
// logic here: intent/target/route arrive from Dev B via the server, which runs
// decideAndEdit (Jev -> composeEditRequest -> agent:submitEdit) in Node.

const statusEl = document.querySelector("#status");
const micEl = document.querySelector("#mic");
const undoEl = document.querySelector("#undo");
const failEl = document.querySelector("#fail");
const historyEl = document.querySelector("#history");
const transcriptEl = document.querySelector("#transcript");
const pointEl = document.querySelector("#point");

// Looked up lazily at use time: React mounts the iframe after connecting,
// and re-renders can replace the node — a module-load const goes stale and
// the post-edit reload silently no-ops (status says Done, pixels never move).
function previewFrame() {
  return document.querySelector("#preview");
}

// Cache-busting preview reload. location.reload() may repaint from the HTTP
// cache (observed: status says Done, pixels don't move); reassigning src
// with a fresh query param forces a new document every time.
function reloadPreview() {
  const f = previewFrame();
  if (!f || !f.src) return;
  try {
    f.src = `${f.src.split("?")[0]}?t=${Date.now()}`;
  } catch {
    try {
      f.contentWindow?.location.reload();
    } catch {
      // Cross-origin or detached frame — leave the pixels alone.
    }
  }
}

let undoTimer;
let lastPoint = null;
let prevStage = "idle";
let lastApplied = null;
let editStartAt = 0;
let editTimer;
let pipeBusy = false;

/** Send is enabled only when the pipeline is idle AND the box has text —
 *  an empty send can only ever 422 ("empty transcript"), so prevent it at
 *  the source instead of showing a fail card for a no-op. */
export function updateSendButton() {
  const sendBtn = document.querySelector("#send");
  if (!sendBtn) return;
  sendBtn.disabled = pipeBusy || !(transcriptEl?.value?.trim());
}

transcriptEl?.addEventListener("input", updateSendButton);

function stopEditTimer() {
  if (editTimer !== undefined) {
    clearInterval(editTimer);
    editTimer = undefined;
  }
}

export function setStatus(line) {
  if (statusEl) statusEl.textContent = line;
}

export function setMic(state, sponsor = "elevenlabs-trial") {
  if (micEl) micEl.textContent = `${state} · ${sponsor}`;
}

export function showUndoCircle(windowMs = 5000) {
  if (!undoEl) return;
  undoEl.style.display = "flex";
  undoEl.textContent = `undo (${Math.round(windowMs / 1000)}s)`;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => {
    undoEl.style.display = "none";
  }, windowMs);
}

export function showFail(message) {
  if (!failEl) return;
  failEl.style.display = "block";
  failEl.textContent = `Couldn't apply: ${message}`;
}

export function hideFail() {
  if (!failEl) return;
  failEl.style.display = "none";
  failEl.textContent = "";
}

export async function invoke(channel, req) {
  const res = await fetch("/api/invoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel, req, project: currentProject() }),
  });
  return res.json();
}

// Workspace project from the URL (/demo vs /finance). The server scopes
// git/executor/probe behavior per project; demo keeps its canned pipeline.
export function currentProject() {
  try {
    const seg = location.pathname.split("/").filter(Boolean)[0];
    return seg ? decodeURIComponent(seg) : "demo";
  } catch {
    return "demo";
  }
}

// Latest live-probe frame (foreign projects only; demo probes server-side).
// Sent with the edit request so the server decides on clicked-what, not a
// stale cache.
let lastFrame = null;

export async function decideAndEdit(transcript, x, y) {
  let res;
  const body = { transcript, x, y, project: currentProject() };
  if (lastFrame && currentProject() !== "demo") body.frame = lastFrame;
  try {
    res = await fetch("/api/decide-and-edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // Server unreachable mid-send: release the mic so the chip can't strand
    // in listening/processing with no pipeline behind it.
    await invoke("speech:stop", undefined);
    return { status: 0, body: { ok: false, code: "unknown", message: "server unreachable" } };
  }
  return { status: res.status, body: await res.json() };
}

// Human-readable narration of what an op does (server statusLines carry the
// file truth; this narrates the op for the done line).
export function describeOp(req) {
  const t = req.target.componentName || req.target.id;
  const op = req.op;
  if (!op) return `${t}: custom edit`;
  switch (op.op) {
    case "set-color":
      return `${t}: color → ${op.param}`;
    case "set-radius":
      return `${t}: corners → ${op.param}`;
    case "set-spacing":
      return `${t}: spacing → ${op.param}`;
    case "set-align":
      return `${t}: align → ${op.param}`;
    case "hide":
      return `${t}: hidden`;
    case "swap-text":
      return `${t}: text → “${op.param}”`;
    default:
      return `${t}: edit`;
  }
}

export async function refreshHistory() {
  const h = await invoke("git:history", undefined);
  if (!h.ok || !historyEl) return;
  historyEl.innerHTML = "";
  for (const s of h.value.slice(-8).reverse()) {
    const li = document.createElement("li");
    li.textContent = `${new Date(s.at).toLocaleTimeString()} ${s.label} @ ${s.sha.slice(0, 8)}`;
    historyEl.appendChild(li);
  }
}

function currentPoint() {
  return lastPoint ?? { x: 50, y: 50 };
}

export async function sendEdit(transcript) {
  hideFail();
  const text = transcript ?? transcriptEl?.value ?? "";
  const { x, y } = currentPoint();
  setStatus(`Sending: “${text}”…`);
  // Local busy gate (mirrors the SSE-driven one): with a dead stream the
  // pipeline never announces editing, so double-sends would both fly and the
  // second 409s. Cleared on every exit below; SSE re-syncs when alive.
  pipeBusy = true;
  updateSendButton();
  const { status, body } = await decideAndEdit(text, x, y);
  if (status === 409) {
    setStatus(`Busy: ${body.message}`);
    pipeBusy = false;
    updateSendButton();
    return;
  }
  if (body.dropped) {
    setStatus(`Ignored (not an edit, actionable=${body.decision.actionable.toFixed(2)})`);
    pipeBusy = false;
    updateSendButton();
    return;
  }
  if (!body.ok) {
    showFail(body.message ?? body.code);
    setStatus("idle");
    pipeBusy = false;
    updateSendButton();
    return;
  }
  lastApplied = body;
  const secs = Math.round(body.undoWindowMs / 1000);
  const flag =
    body.editRequest.route !== "no-llm" && !body.verified ? " (unverified — check it)" : "";
  setStatus(
    `Done: ${describeOp(body.editRequest)} (${body.editResult.filesChanged.join(", ")} @ ${body.editResult.commitSha.slice(0, 8)}) — undo within ${secs}s to revert${flag}`,
  );
  showUndoCircle(body.undoWindowMs);
  reloadPreview();
  refreshHistory();
  pipeBusy = false;
  updateSendButton();
}

function renderPipeline(state) {
  // Gate the send button on pipeline activity: double-sends while busy just
  // 409, so prevent them at the source. Dropped resolves to idle (reset
  // broadcasts), which re-enables.
  pipeBusy =
    state.stage === "listening" ||
    state.stage === "locked" ||
    state.stage === "editing" ||
    state.stage === "verifying";
  updateSendButton();
  // Elapsed clock on model-bound stages: a 40s small-route edit should read
  // as working, not stuck. Ticks only across editing/verifying.
  if (
    (state.stage === "editing" || state.stage === "verifying") &&
    prevStage !== state.stage
  ) {
    editStartAt = Date.now();
    stopEditTimer();
    const label = state.statusLine ?? state.stage;
    editTimer = setInterval(() => {
      const s = Math.round((Date.now() - editStartAt) / 1000);
      setStatus(`${label} (${s}s — model working)`);
    }, 1000);
  } else if (state.stage !== "editing" && state.stage !== "verifying") {
    stopEditTimer();
  }
  if (state.stage === "applied" && prevStage !== "applied") {
    // Edge-triggered from the last /api/decide-and-edit response (which
    // carries undoWindowMs); the event alone re-renders the status line.
    if (lastApplied && state.editId === lastApplied.editRequest.id) {
      const secs = Math.round(lastApplied.undoWindowMs / 1000);
      setStatus(
        `Done: ${describeOp(lastApplied.editRequest)} (${lastApplied.editResult.filesChanged.join(", ")} @ ${lastApplied.editResult.commitSha.slice(0, 8)}) — undo within ${secs}s to revert`,
      );
      showUndoCircle(lastApplied.undoWindowMs);
    }
    refreshHistory();
  }
  if (state.stage === "failed" && prevStage !== "failed") {
    showFail(state.error ?? "unknown");
    refreshHistory();
  }
  if (state.statusLine) setStatus(state.statusLine);
  else if (state.stage === "applied") {
    // Never clobber our own Done line (set above) with the generic text;
    // only narrate applied states we didn't initiate (other tab, reload).
    if (!(lastApplied && state.editId === lastApplied.editRequest.id)) {
      setStatus(`Applied${state.pendingAction === "undo-window" ? " — undo window open" : ""}`);
    }
  } else if (state.stage === "idle") setStatus("idle");
  prevStage = state.stage;
}

const events = new EventSource("/api/events");
let sseAlive = false;
events.onopen = () => {
  sseAlive = true;
};
events.onerror = () => {
  // SSE died (harness restart, proxy blip). EventSource reconnects on its
  // own; say so instead of silently freezing the mic chip / send gating —
  // both now update optimistically/locally and merely reconcile over SSE.
  if (sseAlive) {
    sseAlive = false;
    setStatus("live updates reconnecting… (mic + send keep working; reload if stuck)");
  }
};
events.onmessage = (e) => {
  let msg;
  try {
    msg = JSON.parse(e.data);
  } catch {
    return;
  }
  if (msg.type === "pipeline") renderPipeline(msg.state);
  else if (msg.type === "speech-state") {
    serverMicState = msg.state;
    setMic(msg.state);
    renderMicButton();
  } else if (msg.type === "speech-transcript" && transcriptEl && !msg.event.isFinal) {
    transcriptEl.value = msg.event.text;
  }
};

// Zoom-style mic: one button, bound to the server mic state (single source
// of truth over SSE — never a local guess). Click to unmute, click again to
// mute. Muting finalizes immediately (see micOff): whatever was captured so
// far processes now instead of waiting on the recognizer.
let serverMicState = "off";

export function renderMicButton() {
  const btn = document.querySelector("#mic-toggle");
  if (!btn) return;
  const live = serverMicState === "listening" || serverMicState === "processing";
  btn.textContent = live ? "🔇 Mic off" : "🎙 Mic on";
  btn.setAttribute("aria-pressed", live ? "true" : "false");
}

document.querySelector("#mic-toggle")?.addEventListener("click", async () => {
  if (serverMicState === "off") {
    const r = await invoke("speech:start", undefined);
    if (!r.ok) {
      setStatus(`mic: ${r.message ?? r.code}`);
      return;
    }
    // Optimistic chip flip: the SSE echo confirms it, but the toggle must
    // not depend on stream timing (proxy lag, restart gaps) — otherwise the
    // button reads "Mic on" while the server is already listening and the
    // second click re-arms instead of muting.
    serverMicState = "listening";
    setMic("listening");
    renderMicButton();
    setStatus("Listening… speak, then mic off");
    startWebSpeech();
    // Scribe fallback records the same utterance in parallel (dev-c.md §5.6:
    // Web Speech primary, Scribe fallback). Costs nothing unless uploaded:
    // mic-off uploads ONLY when Web Speech produced no text (fork without
    // speech keys, Safari, network-error session).
    void startRecorder();
  } else {
    await micOff();
  }
});

/** Mute path: stop capture, then finalize the session buffer immediately —
 *  this is the override. The recognizer never gets to declare final; the
 *  buffered text processes now. Empty buffer means nothing was said: just
 *  stop, pipeline untouched. */
export async function micOff() {
  // Optimistic chip reset (mirrors the on-start flip): mute reads instantly
  // even if the SSE echo is delayed. The pipeline flow re-arms via SSE.
  serverMicState = "off";
  setMic("off");
  renderMicButton();
  stopWebSpeech();
  const audio = await stopRecorder();
  const text = sessionText();
  if (text) {
    await finalizeAndSend(text);
    return;
  }
  if (audio) {
    // Web Speech produced nothing for this utterance — transcribe the
    // parallel recording instead of stranding the user at an empty box.
    setStatus("Transcribing… (scribe fallback)");
    try {
      const fallback = await transcribeAudio(audio);
      if (fallback.trim()) {
        await finalizeAndSend(fallback);
        return;
      }
      setStatus("Heard nothing — type in the box, then send");
    } catch (err) {
      setStatus(
        `scribe fallback failed (${err instanceof Error ? err.message : String(err)}) — type in the box, then send`,
      );
    }
    await invoke("speech:stop", undefined);
    return;
  }
  setStatus(
    `Mic captured nothing${recorderError ? ` (recorder: ${recorderError})` : ""} — type in the box, then send`,
  );
  await invoke("speech:stop", undefined);
}
/** Shared finalize-and-send: recognizer-declared finals and mic-off
 *  overrides converge here — one code path into the pipeline. */
export async function finalizeAndSend(text) {
  const t = text.trim();
  if (!t) return;
  discardRecorder();
  stopWebSpeech();
  sessionFinal = "";
  sessionInterim = "";
  fetch("/api/transcript", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: t, isFinal: true }),
  }).catch(() => undefined);
  if (transcriptEl) transcriptEl.value = t;
  updateSendButton();
  await sendEdit(t);
}

// STT capture (dev-c.md 5.6: Web Speech primary). The server owns the mic
// STATE machine; the browser owns the audio. Interim tokens fill the editable
// box (misrecognition mitigation). A recognizer-declared final auto-sends —
// but only if the mic is still on; muting first wins via micOff, which
// finalizes the session buffer instead of waiting on the recognizer.
// No recognizer (e.g. Firefox) -> the box + send button IS the recognizer,
// and the mic button still toggles the server stream (mute = stop).
let webSpeechActive = false;
let webSpeechRec = null;
let webSpeechRetries = 0;
// Session buffer: finalized segments append, latest interim replaces.
// micOff finalizes sessionText() without recognizer involvement.
let sessionFinal = "";
let sessionInterim = "";

export function sessionText() {
  return `${sessionFinal} ${sessionInterim}`.trim().replace(/\s+/g, " ");
}

function webSpeechCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function startWebSpeech() {
  sessionFinal = "";
  sessionInterim = "";
  webSpeechRetries = 0;
  startWebSpeechAttempt();
}

// One attempt; separated so a retry doesn't wipe the retry counter or the
// already-captured session text.
function startWebSpeechAttempt() {
  const Ctor = webSpeechCtor();
  if (!Ctor) {
    setStatus("Listening… (scribe fallback recording — speak, then mic off)");
    return;
  }
  try {
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let interim = "";
      let eventFinal = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const text = res[0]?.transcript ?? "";
        if (res.isFinal) eventFinal += text;
        else interim += text;
      }
      if (eventFinal) sessionFinal += eventFinal;
      sessionInterim = interim;
      const showing = sessionText();
      if (transcriptEl && showing) transcriptEl.value = showing;
      if (eventFinal.trim()) {
        // Recognizer declares final and the mic is still on: its call.
        // (Muted mid-utterance goes through micOff instead — override.)
        void finalizeAndSend(sessionText());
      } else if (interim.trim()) {
        fetch("/api/transcript", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: interim.trim(), isFinal: false }),
        }).catch(() => undefined);
      }
    };
    rec.onerror = (e) => {
      const err = e.error ?? "unknown";
      // Transient recognizer failures (dropped audio service, blip in
      // connectivity): one automatic retry that preserves the session text.
      // Anything else — or a second failure — keeps the typed fallback: the
      // SERVER session stays alive so typing + send flows immediately.
      if ((err === "network" || err === "audio-capture") && webSpeechRetries < 1) {
        webSpeechRetries += 1;
        setStatus(`mic hiccup (${err}) — retrying… or just type in the box`);
        stopWebSpeech();
        setTimeout(() => {
          if (serverMicState === "listening") startWebSpeechAttempt();
        }, 800);
        return;
      }
      setStatus(
        `mic error: ${err} — the browser couldn't reach the speech service (check connection/VPN); type in the box instead`,
      );
      stopWebSpeech();
    };
    rec.onend = () => {
      webSpeechActive = false;
      webSpeechRec = null;
    };
    webSpeechRec = rec;
    webSpeechActive = true;
    rec.start();
  } catch (err) {
    setStatus(`mic unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function stopWebSpeech() {
  webSpeechActive = false;
  try {
    webSpeechRec?.stop();
  } catch {
    // Already stopped; server state is the truth, reset separately.
  }
  webSpeechRec = null;
}

// Scribe fallback capture (dev-c.md §5.6). getUserMedia + MediaRecorder run
// in parallel with Web Speech; the recording is uploaded ONLY when the
// recognizer produced nothing (micOff path). The ElevenLabs key stays
// server-side — the page posts raw audio to /api/transcribe and gets text.
let recorderStream = null;
let recorder = null;
let recorderChunks = [];
let recorderMime = "";
// Last capture failure reason — surfaced at mic-off so a dead recorder is
// diagnosable instead of a silent "captured nothing".
let recorderError = null;

export async function startRecorder() {
  discardRecorder();
  recorderError = null;
  try {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      recorderError = "no MediaRecorder/getUserMedia in this browser";
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    let mime = "";
    try {
      mime =
        ["audio/webm", "audio/mp4"].find((m) => {
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
    recorderMime = rec.mimeType || mime || "audio/webm";
    recorderChunks = [];
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recorderChunks.push(e.data);
    };
    rec.start(250);
    recorderStream = stream;
    recorder = rec;
  } catch (err) {
    // Denied/unsupported: Web Speech (or typing) remains the path. The reason
    // is kept for the mic-off diagnosis line below.
    recorderError = err instanceof Error ? err.message : String(err);
    recorder = null;
  }
}

function stopRecorderTracks() {
  try {
    recorderStream?.getTracks().forEach((t) => t.stop());
  } catch {
    // Already stopped.
  }
  recorderStream = null;
}

export function discardRecorder() {
  try {
    recorder?.stop();
  } catch {
    // Already stopped.
  }
  recorder = null;
  recorderChunks = [];
  stopRecorderTracks();
}

/** Stop capture and resolve the recorded utterance (null when unusable). */
export function stopRecorder() {
  return new Promise((resolve) => {
    const rec = recorder;
    recorder = null;
    const finish = () => {
      const blob =
        recorderChunks.length > 0 ? new Blob(recorderChunks, { type: recorderMime || "audio/webm" }) : null;
      recorderChunks = [];
      stopRecorderTracks();
      resolve(blob && blob.size > 0 ? blob : null);
    };
    if (!rec || rec.state === "inactive") {
      finish();
      return;
    }
    let settled = false;
    const once = () => {
      if (settled) return;
      settled = true;
      finish();
    };
    try {
      rec.onstop = once;
      rec.stop();
      setTimeout(once, 1500); // never strand mute on a stuck encoder
    } catch {
      once();
    }
  });
}

export async function transcribeAudio(blob) {
  const res = await fetch("/api/transcribe", {
    method: "POST",
    headers: { "Content-Type": blob.type || "audio/webm" },
    body: blob,
  });
  const body = await res.json();
  if (!body.ok) throw new Error(body.message ?? body.code ?? "transcribe failed");
  return body.value.text;
}

document.querySelector("#send")?.addEventListener("click", () => {
  sendEdit();
});

document.querySelector("#new-version")?.addEventListener("click", async () => {
  const r = await invoke("git:createSnapshot", { label: `v${new Date().toLocaleTimeString()}` });
  setStatus(r.ok ? `Version saved @ ${r.value.sha.slice(0, 8)}` : `Version: ${r.message ?? r.code}`);
  refreshHistory();
});

undoEl?.addEventListener("click", async () => {
  const r = await invoke("git:undo", undefined);
  setStatus(r.ok ? `Undone: reverted to pre-edit state (${r.value.sha.slice(0, 8)})` : `Undo: ${r.message ?? r.code}`);
  if (undoEl) undoEl.style.display = "none";
  hideFail();
  reloadPreview();
  refreshHistory();
});

// Click-to-override fallback (Dev A): click selects the point; the next send
// uses it as the gaze point for preview:queryElementAt. The component under
// the click is identified immediately (same probe Jev disambiguates on send)
// so the user sees WHAT was hit, not just raw coordinates.
window.addEventListener("message", (e) => {
  if (e.data && e.data.type === "preview-frame") {
    // Foreign live probe (probe.js): the frame arrives WITH the click, so
    // identification needs no server roundtrip. Stored for the send body.
    lastPoint = { x: e.data.x, y: e.data.y };
    const f = e.data.frame;
    if (!f || !Array.isArray(f.candidates) || f.candidates.length === 0) {
      if (pointEl) pointEl.textContent = `point ${e.data.x},${e.data.y} — no component here`;
      setStatus(`Clicked empty space at ${e.data.x},${e.data.y} — try clicking an element`);
      return;
    }
    lastFrame = f;
    const locked =
      f.lockedTarget ??
      [...f.candidates]
        .reverse()
        .find((c) => {
          const r = c.boundingRect;
          return (
            e.data.x >= r.x && e.data.x <= r.x + r.width && e.data.y >= r.y && e.data.y <= r.y + r.height
          );
        }) ??
      f.candidates[0];
    const label = locked.componentName ?? locked.id;
    const others = f.candidates.length > 1 ? ` · +${f.candidates.length - 1} nearby` : "";
    if (pointEl) pointEl.textContent = `${label}${others} — send an edit to apply`;
    setStatus(`Target: ${label} — describe the change, then send`);
    return;
  }
  if (e.data && e.data.type === "preview-click") {
    lastPoint = { x: e.data.x, y: e.data.y };
    if (pointEl) pointEl.textContent = `point ${e.data.x},${e.data.y} — identifying…`;
    setStatus(`Clicked preview at ${e.data.x},${e.data.y} — identifying component…`);
    void identifyPoint(e.data.x, e.data.y);
  }
});

export async function identifyPoint(x, y) {
  let frame;
  try {
    frame = await invoke("preview:queryElementAt", { x, y });
  } catch {
    frame = { ok: false };
  }
  if (!frame.ok) {
    if (pointEl) pointEl.textContent = `point ${x},${y} (override armed)`;
    setStatus(`Clicked preview at ${x},${y} — send an edit to apply there`);
    return null;
  }
  const cands = frame.value?.candidates ?? [];
  // Deepest containing candidate = most specific element (mirrors the
  // server hit-test: parents contain their children, so the last match wins).
  let hit = frame.value?.lockedTarget ?? null;
  if (!hit) {
    for (const c of cands) {
      const r = c.boundingRect;
      if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) hit = c;
    }
    hit ??= cands[0] ?? null;
  }
  if (!hit) {
    if (pointEl) pointEl.textContent = `point ${x},${y} — no component here`;
    setStatus(`Clicked empty space at ${x},${y} — try clicking an element`);
    return null;
  }
  const label = hit.componentName ?? hit.id;
  const file = hit.filePath ? ` (${hit.filePath})` : " (unmapped file)";
  const others = cands.length > 1 ? ` · +${cands.length - 1} nearby` : "";
  if (pointEl) pointEl.textContent = `${label}${file}${others} — send an edit to apply`;
  setStatus(`Target: ${label}${file} — describe the change, then send`);
  return hit;
}

refreshHistory();
renderMicButton();
updateSendButton();

window.mhacks = {
  invoke,
  decideAndEdit,
  sendEdit,
  setStatus,
  setMic,
  showUndoCircle,
  refreshHistory,
  startWebSpeech,
  stopWebSpeech,
  micOff,
  finalizeAndSend,
  sessionText,
  renderMicButton,
  identifyPoint,
  startRecorder,
  stopRecorder,
  discardRecorder,
  transcribeAudio,
  updateSendButton,
  currentProject,
};
