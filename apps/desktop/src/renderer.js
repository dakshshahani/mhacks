// Browser-safe harness client (plain JS — no TS, no imports).
// Talks to the thin static server's /api/invoke, which runs the REAL shell
// services (FileGitService, executor, Tier-1) in Node. Gaze/STT/LLM stay
// stubbed at the boundary: the demo EditRequest below stands in for
// Dev B's Decision -> composeEditRequest output.

const statusEl = document.querySelector("#status");
const micEl = document.querySelector("#mic");
const undoEl = document.querySelector("#undo");
let undoTimer;

export function setStatus(line) {
  if (statusEl) statusEl.textContent = line;
}

export function setMic(state, sponsor = "elevenlabs-trial") {
  if (micEl) micEl.textContent = `${state} · ${sponsor}`;
}

export function showUndoCircle(windowMs = 5000) {
  if (!undoEl) return;
  undoEl.style.display = "flex";
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => {
    undoEl.style.display = "none";
  }, windowMs);
}

export async function invoke(channel, req) {
  const res = await fetch("/api/invoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel, req }),
  });
  return res.json();
}

// Human-readable narration of what an op does (Dev B writes status lines in
// prod; the harness narrates locally so done-vs-undone is visible).
const OP_TEXT = {
  "set-color": (t, p) => `${t}: color → ${p}`,
  "set-radius": (t, p) => `${t}: corners → ${p}`,
  "set-spacing": (t, p) => `${t}: spacing → ${p}`,
  "set-align": (t, p) => `${t}: align → ${p}`,
  hide: (t) => `${t}: hidden`,
  "swap-text": (t, p) => `${t}: text → “${p}”`,
};
export function describeOp(req) {
  const t = req.target.componentName || req.target.id;
  const op = req.op;
  if (!op) return `${t}: custom edit`;
  const fmt = OP_TEXT[op.op];
  return fmt ? fmt(t, op.param) : `${t}: edit`;
}
// Target c0 -> demo/Hero.tsx. Replace with live Jev output at G2/G3.
export function demoEditRequest(op = { op: "set-color", param: "brand" }) {
  return {
    id: `e-${Date.now().toString(36)}`,
    transcript: "make it brand",
    intent: "style",
    target: {
      id: "c0",
      selector: "div.hero",
      componentName: "Hero",
      filePath: "Hero.tsx",
      boundingRect: { x: 10, y: 10, width: 200, height: 40 },
      outerHTMLSnippet: '<div class="hero">Hello demo</div>',
      htmlTruncated: false,
      confidence: 0.9,
      trackedConfidence: 0.95,
      supportedOps: [{ op: "set-color", param: "brand" }],
    },
    op,
    route: "no-llm",
    riskScore: 0.1,
  };
}

document.querySelector("#toggle")?.addEventListener("click", async () => {
  const r = await invoke("speech:start", undefined);
  if (r.ok) {
    setMic("listening");
    setStatus("Listening… (stub recognizer)");
  } else {
    setStatus(`mic: ${r.message ?? r.code}`);
  }
});

document.querySelector("#demo-edit")?.addEventListener("click", async () => {
  const edit = demoEditRequest();
  setStatus(`Editing: ${describeOp(edit)}…`);
  const r = await invoke("agent:submitEdit", edit);
  if (r.ok) {
    setStatus(`Done: ${describeOp(edit)} (${r.value.filesChanged.join(", ")} @ ${r.value.commitSha.slice(0, 8)}) — undo within 5s to revert`);
    showUndoCircle(5000);
    document.querySelector("#preview")?.contentWindow?.location.reload();
  } else {
    setStatus(`Failed: ${r.message ?? r.code}`);
  }
});

undoEl?.addEventListener("click", async () => {
  const r = await invoke("git:undo", undefined);
  setStatus(r.ok ? `Undone: reverted to pre-edit state (${r.value.sha.slice(0, 8)})` : `Undo: ${r.message ?? r.code}`);
  if (undoEl) undoEl.style.display = "none";
  document.querySelector("#preview")?.contentWindow?.location.reload();
});

// Click fallback inside the iframe bubbles here via postMessage.
window.addEventListener("message", (e) => {
  if (e.data && e.data.type === "preview-click") {
    setStatus(`Clicked preview at ${e.data.x},${e.data.y} (override armed)`);
  }
});

window.mhacks = { invoke, demoEditRequest, setStatus, setMic, showUndoCircle };
