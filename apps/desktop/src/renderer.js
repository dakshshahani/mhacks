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
const previewEl = document.querySelector("#preview");

let undoTimer;
let lastPoint = null;
let prevStage = "idle";
let lastApplied = null;

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
    body: JSON.stringify({ channel, req }),
  });
  return res.json();
}

export async function decideAndEdit(transcript, x, y) {
  const res = await fetch("/api/decide-and-edit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript, x, y }),
  });
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
  const { status, body } = await decideAndEdit(text, x, y);
  if (status === 409) {
    setStatus(`Busy: ${body.message}`);
    return;
  }
  if (body.dropped) {
    setStatus(`Ignored (not an edit, actionable=${body.decision.actionable.toFixed(2)})`);
    return;
  }
  if (!body.ok) {
    showFail(body.message ?? body.code);
    setStatus("idle");
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
  previewEl?.contentWindow?.location.reload();
  refreshHistory();
}

function renderPipeline(state) {
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
    // Listening state arrives over SSE; no optimistic chip update.
    startWebSpeech();
  } else {
    await micOff();
  }
});

/** Mute path: stop capture, then finalize the session buffer immediately —
 *  this is the override. The recognizer never gets to declare final; the
 *  buffered text processes now. Empty buffer means nothing was said: just
 *  stop, pipeline untouched. */
export async function micOff() {
  stopWebSpeech();
  const text = sessionText();
  if (!text) {
    await invoke("speech:stop", undefined);
    return;
  }
  await finalizeAndSend(text);
}

/** Shared finalize-and-send: recognizer-declared finals and mic-off
 *  overrides converge here — one code path into the pipeline. */
export async function finalizeAndSend(text) {
  const t = text.trim();
  if (!t) return;
  stopWebSpeech();
  sessionFinal = "";
  sessionInterim = "";
  fetch("/api/transcript", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: t, isFinal: true }),
  }).catch(() => undefined);
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
  const Ctor = webSpeechCtor();
  if (!Ctor) {
    setStatus("Listening… (type in the box, then send — no browser recognizer)");
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
      setStatus(`mic error: ${e.error ?? "unknown"} — type in the box instead`);
      stopWebSpeech();
      invoke("speech:stop", undefined);
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
  previewEl?.contentWindow?.location.reload();
  refreshHistory();
});

// Click-to-override fallback (Dev A): click selects the point; the next send
// uses it as the gaze point for preview:queryElementAt.
window.addEventListener("message", (e) => {
  if (e.data && e.data.type === "preview-click") {
    lastPoint = { x: e.data.x, y: e.data.y };
    if (pointEl) pointEl.textContent = `point ${e.data.x},${e.data.y} (override armed)`;
    setStatus(`Clicked preview at ${e.data.x},${e.data.y} — send an edit to apply there`);
  }
});

refreshHistory();
renderMicButton();

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
};
