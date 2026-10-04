// Browser-harness client (plain JS).
// Thin client over the ipc.ts contract + the pipeline SSE stream. No decision
// logic here: intent/target/route arrive from Dev B via the server, which runs
// decideAndEdit (Jev -> composeEditRequest -> agent:submitEdit) in Node.

import { createGazeController } from "./gaze/controller.js";
import {
  ensureElectronPreview,
  initShellPreview,
  isElectronShell,
  isWebviewElement,
  refreshShellPreview,
  reloadWebview,
  webviewFacade,
} from "./preview-embed.js";
import {
  decideAndEdit as transportDecideAndEdit,
  ensureMediaAccess,
  invoke as transportInvoke,
  pushTranscript,
  subscribeEvents,
  transcribeAudio as transportTranscribe,
} from "./transport.js";

const statusEl = document.querySelector("#status");
const micEl = document.querySelector("#mic");
const undoEl = document.querySelector("#undo");
const failEl = document.querySelector("#fail");
const historyEl = document.querySelector("#history");
const transcriptEl = document.querySelector("#transcript");
const pointEl = document.querySelector("#point");

// Electron shell: the preview is a <webview> (same URL, real probe via the
// guest bridge) instead of the harness <iframe>. Null on the harness path.
// Initialized once: React-free shell, no re-mounts to go stale on.
const previewWebview = ensureElectronPreview();

// Looked up lazily at use time: React mounts the iframe after connecting,
// and re-renders can replace the node — a module-load const goes stale and
// the post-edit reload silently no-ops (status says Done, pixels never move).
function previewFrame() {
  return previewWebview ?? document.querySelector("#preview");
}

/** Element the gaze pump probes: the webview facade in the shell (its
 *  contentWindow.postMessage routes through the guest bridge), else the raw
 *  iframe. Same coordinate contract either way. */
function gazePreview() {
  if (previewWebview && isWebviewElement(previewWebview)) return webviewFacade(previewWebview);
  return document.querySelector("#preview");
}

// Cache-busting preview reload. location.reload() may repaint from the HTTP
// cache (observed: status says Done, pixels never move); reassigning src
// with a fresh query param forces a new document every time. Wrapped in a
// View Transition when the browser supports it so the old pixels ease into
// the new ones (see globals.css for the cubic curve) instead of flashing.
function reloadPreview() {
  const f = previewFrame();
  if (!f || !f.src) return;
  if (previewWebview && f === previewWebview) {
    lastFrame = null;
    lastPoint = null;
    // Shell: main regenerates the data: URL preview. Harness fallback
    // (unreachable — the webview only shows in the shell): loadURL swap.
    void refreshShellPreview(f).then((handled) => {
      if (!handled) reloadWebview(f);
    });
    return;
  }
  lastFrame = null;
  lastPoint = null;
  const swap = () => {
    try {
      f.src = `${f.src.split("?")[0]}?t=${Date.now()}`;
    } catch {
      try {
        f.contentWindow?.location.reload();
      } catch {
        // Cross-origin or detached frame — leave the pixels alone.
      }
    }
  };
  if (typeof document.startViewTransition !== "function") {
    swap();
    return;
  }
  document.startViewTransition(async () => {
    swap();
    // Settle the transition on the new document, never hang it on a slow one.
    await new Promise((resolve) => {
      const done = () => {
        f.removeEventListener("load", done);
        resolve();
      };
      f.addEventListener("load", done);
      setTimeout(done, 2000);
    });
  });
}

let undoTimer;
let lastPoint = null;
let prevStage = "idle";
let lastApplied = null;
let editStartAt = 0;
let editTimer;
let pipeBusy = false;
let gazeController = null;

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
  // Contract channels, either transport. The shell is template-only: main
  // ignores project (demo-scoped services); the harness still scopes by it.
  return transportInvoke(channel, req, currentProject());
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

// Latest live-probe frame. Sent with the edit request so the server decides
// on clicked-what, not a stale cache.
let lastFrame = null;

export async function decideAndEdit(transcript, x, y) {
  let res;
  const body = { transcript, x, y };
  if (lastFrame && Array.isArray(lastFrame.candidates) && lastFrame.candidates.length > 0) {
    body.frame = lastFrame;
  }
  try {
    res = await transportDecideAndEdit(body, currentProject());
  } catch {
    // Server unreachable mid-send: release the mic so the chip can't strand
    // in listening/processing with no pipeline behind it. The stop itself is
    // guarded — a dead bridge must surface "server unreachable", never a
    // second throw that freezes the send button on "Sending…" forever.
    try {
      await invoke("speech:stop", undefined);
    } catch {
      // Bridge dead too; the status below already says enough.
    }
    return { status: 0, body: { ok: false, code: "unknown", message: "server unreachable" } };
  }
  return res;
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
    case "set-weight":
      return `${t}: weight → ${op.param}`;
    case "set-size":
      return `${t}: size → ${op.param}`;
    case "hide":
      return `${t}: hidden`;
    case "swap-text":
      return `${t}: text → “${op.param}”`;
    default:
      return `${t}: edit`;
  }
}

// History pane: HiFi Prompt containers. First click checks out the snapshot
// (working tree only, history kept); clicking the checked-out entry again
// reverts to it and drops everything above it.
let checkedOutSha = null;
let toggleBusy = false;

export function clearCheckedOut() {
  checkedOutSha = null;
}

function relTime(at) {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return `${s} seconds ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  return `${Math.round(m / 60)} hour${Math.round(m / 60) === 1 ? "" : "s"} ago`;
}

async function toggleVersion(sha, label) {
  // One flight at a time: rapid double-clicks must not interleave a checkout
  // with the revert it was meant to trigger (or vice versa).
  if (toggleBusy) return;
  toggleBusy = true;
  hideFail();
  try {
    if (checkedOutSha === sha) {
      const r = await invoke("git:revertTo", { sha });
      if (!r.ok) {
        await staleVersionRecovery(r, sha);
        return;
      }
      checkedOutSha = null;
      setStatus(`Reverted to ${label} @ ${sha.slice(0, 8)} — newer versions dropped`);
    } else {
      const r = await invoke("git:checkout", { sha });
      if (!r.ok) {
        await staleVersionRecovery(r, sha);
        return;
      }
      checkedOutSha = sha;
      setStatus(`Viewing ${label} @ ${sha.slice(0, 8)} — click again to revert here`);
    }
    reloadPreview();
    refreshHistory();
  } finally {
    toggleBusy = false;
  }
}

/** The pane outlives the store: entries vanish when history is truncated
 *  elsewhere (a revert in another tab), the snapshot dir is cleaned, or the
 *  tab was rendered against a different backend than clicks now reach.
 *  Resync the pane and say so instead of erroring on a ghost. */
async function staleVersionRecovery(r, sha) {
  const message = r.message ?? r.code;
  if (/unknown sha|nothing to restore/i.test(message)) {
    checkedOutSha = null;
    setStatus("That version is no longer in history — refreshed the list");
    await refreshHistory();
    return;
  }
  showFail(message);
}

export async function refreshHistory() {
  const h = await invoke("git:history", undefined);
  if (!h.ok || !historyEl) return;
  historyEl.innerHTML = "";
  // Undo markers are bookkeeping, not versions — the pane shows restorable
  // snapshots newest-first.
  const versions = h.value.filter((s) => !s.label.startsWith("undo ")).slice(-8).reverse();
  if (checkedOutSha && !versions.some((s) => s.sha === checkedOutSha)) checkedOutSha = null;
  for (const s of versions) {
    const li = document.createElement("li");
    li.className = "prompt-card";
    li.dataset.sha = s.sha;
    const selected = checkedOutSha === s.sha;
    if (selected) li.classList.add("is-selected");
    li.tabIndex = 0;
    li.setAttribute("role", "button");
    li.setAttribute(
      "aria-label",
      selected ? `Revert to ${s.label}` : `Check out ${s.label}`,
    );
    const meta = document.createElement("div");
    meta.className = "prompt-meta";
    const label = document.createElement("span");
    label.className = "prompt-label";
    label.textContent = s.label;
    const time = document.createElement("span");
    time.className = "prompt-time";
    time.textContent = relTime(s.at);
    meta.append(label, time);
    const body = document.createElement("div");
    body.className = "prompt-body";
    body.textContent = `${s.label} @ ${s.sha.slice(0, 8)}`;
    const hint = document.createElement("div");
    hint.className = "prompt-hint";
    hint.textContent = selected ? "viewing — click again to revert here" : "click to view this version";
    li.append(meta, body, hint);
    li.addEventListener("click", () => void toggleVersion(s.sha, s.label));
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        void toggleVersion(s.sha, s.label);
      }
    });
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
  clearCheckedOut();
  const secs = Math.round(body.undoWindowMs / 1000);  const flag =
    body.editRequest.route !== "no-llm" && !body.verified ? " (unverified — check it)" : "";
  const jevMs = typeof body.decisionMs === "number" ? ` · Jev ${Math.round(body.decisionMs)}ms` : "";
  setStatus(
    `Done: ${describeOp(body.editRequest)} (${body.editResult.filesChanged.join(", ")} @ ${body.editResult.commitSha.slice(0, 8)}) — undo within ${secs}s to revert${flag}${jevMs}`,
  );
  showUndoCircle(body.undoWindowMs);
  reloadPreview();
  refreshHistory();
  pipeBusy = false;
  // A completed utterance belongs to the edit that just applied. Clear it so
  // the next mic session starts with an empty command instead of appending to
  // stale text from the previous component.
  if (transcriptEl) transcriptEl.value = "";
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
    // A new edit landed: any checked-out older version is stale.
    clearCheckedOut();
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

// Live pipeline/speech stream: native bridge events in the shell, SSE in the
// harness. Same dispatch — the renderers below never know which.
subscribeEvents({
  onPipeline: (state) => renderPipeline(state),
  onSpeechState: (state) => {
    serverMicState = state;
    gazeController?.setSpeechState(state);
    setMic(state);
    renderMicButton();
  },
  onTranscript: (event) => {
    if (transcriptEl && !event.isFinal) transcriptEl.value = event.text;
  },
  onStreamDown: () => {
    // Harness-only: SSE died (restart, proxy blip). The bridge doesn't drop.
    // Mic + send keep working locally; reload if stuck.
    setStatus("live updates reconnecting… (mic + send keep working; reload if stuck)");
  },
});

// Zoom-style mic: one button, bound to the server mic state (single source
// of truth over SSE — never a local guess). Click to unmute, click again to
// mute. A mic session stays active across auto-submitted utterances; muting
// finalizes immediately (see micOff): whatever was captured so far processes
// now instead of waiting on the recognizer.
let serverMicState = "off";
let micSessionActive = false;

export function renderMicButton() {
  const btn = document.querySelector("#mic-toggle");
  if (!btn) return;
  const live =
    micSessionActive || serverMicState === "listening" || serverMicState === "processing";
  btn.textContent = live ? "🔇 Mic off" : "🎙 Mic on";
  btn.setAttribute("aria-pressed", live ? "true" : "false");
}

/** Start one recognizer turn inside the current continuous mic session. */
async function beginMicCapture() {
  // OS prompt first (shell-only; harness no-ops): without the TCC grant the
  // recorder + recognizer capture silence and fail opaquely.
  await ensureMediaAccess("microphone");
  const r = await invoke("speech:start", undefined);
  if (!r.ok) {
    micSessionActive = false;
    setStatus(`mic: ${r.message ?? r.code}`);
    renderMicButton();
    return false;
  }
  if (!micSessionActive) {
    await invoke("speech:stop", undefined);
    return false;
  }
  serverMicState = "listening";
  setMic("listening");
  renderMicButton();
  startWebSpeech();
  // Scribe fallback records the same utterance in parallel. It is consumed
  // only if this recognizer turn produces no Web Speech text.
  void startRecorder();
  return true;
}

document.querySelector("#mic-toggle")?.addEventListener("click", async () => {
  if (!micSessionActive && serverMicState === "off") {
    // Set this before awaiting the server so the user can click Mic off even
    // if the IPC/SSE echo is slow.
    micSessionActive = true;
    renderMicButton();
    setStatus("Listening… speak, then mic off");
    await beginMicCapture();
  } else {
    await micOff();
  }
});

/** Mute path: stop capture, then finalize the session buffer immediately —
 *  this is the override. The recognizer never gets to declare final; the
 *  buffered text processes now. Empty buffer means nothing was said: just
 *  stop, pipeline untouched. */
export async function micOff() {
  micSessionActive = false;
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
export async function finalizeAndSend(text, resumeMic = false) {
  const t = text.trim();
  if (!t) return;
  discardRecorder();
  stopWebSpeech();
  sessionFinal = "";
  sessionInterim = "";
  pushTranscript(t, true);
  if (transcriptEl) transcriptEl.value = t;
  updateSendButton();
  await sendEdit(t);
  if (resumeMic && micSessionActive) {
    await beginMicCapture();
    if (micSessionActive) setStatus("Listening… speak, then mic off");
  }
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
let autoFinalizing = false;
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
  // Each mic activation is a new command. Keep failed edits/type-to-send
  // text intact, but never carry an already-applied utterance into this one.
  if (transcriptEl) transcriptEl.value = "";
  updateSendButton();
  startWebSpeechAttempt();
}

// One attempt; separated so a retry doesn't wipe the retry counter or the
// already-captured session text.
function startWebSpeechAttempt() {
  // Electron shell: Web Speech is Google-backed and Electron builds carry
  // no API key, so the recognizer ALWAYS fails here (network error after a
  // pointless retry). Skip it outright — the parallel Scribe recording
  // (startRecorder, already running) is the real path: speak, release, and
  // micOff transcribes. Browsers keep the Web Speech primary below.
  if (isElectronShell()) {
    setStatus("Listening… (scribe recording — speak, then release)");
    return;
  }
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
        if (!autoFinalizing && micSessionActive) {
          autoFinalizing = true;
          void finalizeAndSend(sessionText(), true).finally(() => {
            autoFinalizing = false;
          });
        }
      } else if (interim.trim()) {
        pushTranscript(interim.trim(), false);
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
  return transportTranscribe(blob);
}

document.querySelector("#send")?.addEventListener("click", () => {
  sendEdit();
});

document.querySelector("#new-version")?.addEventListener("click", async () => {
  const r = await invoke("git:createSnapshot", { label: `v${new Date().toLocaleTimeString()}` });
  setStatus(r.ok ? `Version saved @ ${r.value.sha.slice(0, 8)}` : `Version: ${r.message ?? r.code}`);
  clearCheckedOut();
  refreshHistory();
});

undoEl?.addEventListener("click", async () => {
  const r = await invoke("git:undo", undefined);
  setStatus(r.ok ? `Undone: reverted to pre-edit state (${r.value.sha.slice(0, 8)})` : `Undo: ${r.message ?? r.code}`);
  if (undoEl) undoEl.style.display = "none";
  hideFail();
  clearCheckedOut();
  reloadPreview();
  refreshHistory();
});

// Click-to-override fallback (Dev A): click selects the point; the next send
// uses it as the gaze point for preview:queryElementAt. The component under
// the click is identified immediately (same probe Jev disambiguates on send)
// so the user sees WHAT was hit, not just raw coordinates.
//
// Two transports, one handler: the harness iframe posts preview-frame to
// parent (this page); the Electron webview's guest bridge forwards the same
// shape via sendToHost → ipc-message. Both arrive WITH the frame, so
// identification needs no server roundtrip. Stored for the send body.
export function handlePreviewFrame(data) {
  lastPoint = { x: data.x, y: data.y };
  const f = data.frame;
  if (!f || !Array.isArray(f.candidates) || f.candidates.length === 0) {
    if (pointEl) pointEl.textContent = `point ${data.x},${data.y} — no component here`;
    setStatus(`Clicked empty space at ${data.x},${data.y} — try clicking an element`);
    return;
  }
  lastFrame = f;
  gazeController?.acceptExternalFrame(f, { x: data.x, y: data.y });
  const locked =
    f.lockedTarget ??
    [...f.candidates]
      .reverse()
      .find((c) => {
        const r = c.boundingRect;
        return (
          data.x >= r.x && data.x <= r.x + r.width && data.y >= r.y && data.y <= r.y + r.height
        );
      }) ??
    f.candidates[0];
  const label = locked.componentName ?? locked.id;
  const others = f.candidates.length > 1 ? ` · +${f.candidates.length - 1} nearby` : "";
  if (pointEl) pointEl.textContent = `${label}${others} — send an edit to apply`;
  setStatus(`Target: ${label} — describe the change, then send`);
}

window.addEventListener("message", (e) => {
  if (e.data && e.data.type === "preview-frame") {
    handlePreviewFrame(e.data);
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
  clearCheckedOut,
  startWebSpeech,
  stopWebSpeech,
  micOff,
  finalizeAndSend,
  sessionText,
  renderMicButton,
  identifyPoint,
  handlePreviewFrame,
  startRecorder,
  stopRecorder,
  discardRecorder,
  transcribeAudio,
  updateSendButton,
  currentProject,
};

gazeController = createGazeController({
  getPreview: gazePreview,
  onFrame: ({ frame, previewPoint }) => {
    lastFrame = frame;
    if (previewPoint) lastPoint = previewPoint;
    const target = frame.lockedTarget ?? frame.candidates?.at(-1) ?? frame.candidates?.[0] ?? null;
    if (target && pointEl) {
      pointEl.textContent = `${target.componentName ?? target.id}${frame.lockedTarget ? " — locked" : ""}`;
    }
  },
  onStatus: (message) => {
    if (!pipeBusy) setStatus(message);
  },
  onInvalidate: () => {
    // The preview scrolled or reloaded under us: the learned target geometry
    // is void. Drop it so the next send can't edit a stale element; the next
    // gaze frame or click re-acquires.
    lastFrame = null;
    lastPoint = null;
    if (pointEl) pointEl.textContent = "Click the preview to select a target";
  },
});
gazeController.start();

// Shell camera prompt (harness no-ops): head tracking getUserMedia needs the
// OS grant, otherwise the tracker dies silently and only click-override
// remains. Asked once here; the OS remembers the answer per app.
void ensureMediaAccess("camera");

// Shell startup handshake: set the guest preload, then ask main to load the
// generated preview (main pends until the guest exists — race-free).
void initShellPreview(previewWebview);

// Electron shell: guest-bridge messages from the preview webview. Scoped to
// our own webview element by construction (no origin/source check possible
// or needed — sendToHost only fires from this guest).
if (previewWebview) {
  previewWebview.addEventListener("ipc-message", (e) => {
    const arg = e.args?.[0];
    if (!arg) return;
    if (e.channel === "preview-frame") handlePreviewFrame(arg);
    else if (e.channel === "preview-gaze-frame") gazeController?.acceptProbeReply(arg);
  });
}
