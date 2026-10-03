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
  setStatus(
    `Done: ${describeOp(body.editRequest)} (${body.editResult.filesChanged.join(", ")} @ ${body.editResult.commitSha.slice(0, 8)}) — undo within ${secs}s to revert`,
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
  else if (msg.type === "speech-state") setMic(msg.state);
  else if (msg.type === "speech-transcript" && transcriptEl && !msg.event.isFinal) {
    transcriptEl.value = msg.event.text;
  }
};

document.querySelector("#toggle")?.addEventListener("click", async () => {
  const r = await invoke("speech:start", undefined);
  if (!r.ok) setStatus(`mic: ${r.message ?? r.code}`);
  // Listening state arrives over SSE; no optimistic chip update.
});

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

window.mhacks = { invoke, decideAndEdit, sendEdit, setStatus, setMic, showUndoCircle, refreshHistory };
