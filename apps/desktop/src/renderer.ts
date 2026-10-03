// Dev C: browser-harness renderer. Thin client over the ipc.ts contract;
// no decision logic here (intent/target/route arrive from Dev B via IPC).
// PM owns overlay rendering; this file only wires channels to DOM.

const mic = document.querySelector("#mic");
const statusEl = document.querySelector("#status");
const undo = document.querySelector("#undo") as HTMLElement | null;

let undoTimer: number | undefined;

export function showUndoCircle(windowMs = 5000): void {
  if (!undo) return;
  undo.style.display = "flex";
  window.clearTimeout(undoTimer);
  undoTimer = window.setTimeout(() => {
    if (undo) undo.style.display = "none";
  }, windowMs);
}

export function setStatus(line: string): void {
  if (statusEl) statusEl.textContent = line;
}

export function setMic(state: string, sponsor = "elevenlabs-trial"): void {
  if (mic) mic.textContent = `${state} · ${sponsor}`;
}

document.querySelector("#toggle")?.addEventListener("click", () => {
  setMic("listening");
  setStatus("Listening…");
});

undo?.addEventListener("click", () => {
  setStatus("Undo requested");
  if (undo) undo.style.display = "none";
});
