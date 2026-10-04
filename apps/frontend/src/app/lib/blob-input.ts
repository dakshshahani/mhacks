// Shared pointer primitive for the gaze blob (see ../components/blob.tsx).
// One owner for global click-keys so landing, gallery, and project pages
// behave identically. Browser-only: import from client components only.
//
// Rules (grill-locked):
// - Typing always wins: focus in an editable → space types, never clicks.
// - Native activation always wins: focus on a button/link → browser handles
//   it, we stay out (no double activation).
// - Project pages (an enabled #mic-toggle exists, i.e. the harness voice
//   dock is connected) → spacebar is PUSH-TO-TALK: keydown starts the mic,
//   keyup stops it and the buffered utterance submits (micOff finalizes).
//   Clicks there are dwell + physical mouse. Ownership is tracked so a
//   mouse-started session is never inverted by the key.
// - Everywhere else → spacebar clicks whatever is under the blob.
// - Key repeat never re-fires (holding space must not flap mic/click).
// - Scroll caveat: spacebar no longer scrolls the page (arrows/trackpad do).
// - R recenters gaze (see RECENTER_EVENT): neutral resets to the current head
//   pose and the blob snaps to viewport center. Typing r in a field always
//   wins — the key is ignored there.

export interface BlobPoint {
  x: number;
  y: number;
}

/** Fresh gaze override written by a gaze client (Dev A seam). The blob
 *  prefers this when newer than GAZE_FRESH_MS, else the mouse. Shape is
 *  JSON-primitive so any client (JS/TS, any frame) can publish it. */
export interface GazePoint extends BlobPoint {
  at: number;
}

export const GAZE_FRESH_MS = 1500;

const CLICKABLE =
  "a,button,[role=button],summary,input,select,textarea,[contenteditable]";
const NATIVE_FOCUS =
  "a,button,input,select,textarea,[role=button],[contenteditable],summary";

declare global {
  interface Window {
    __gazePoint?: GazePoint | null;
  }
}

/** Latest gaze point if a client is publishing a fresh one, else null. */
export function gazePoint(): BlobPoint | null {
  if (typeof window === "undefined") return null;
  const g = window.__gazePoint;
  if (!g || typeof g.x !== "number" || typeof g.y !== "number") return null;
  if (typeof g.at !== "number" || performance.now() - g.at > GAZE_FRESH_MS) return null;
  return { x: g.x, y: g.y };
}

/** Click (or focus) whatever is under the point. The blob itself is
 *  pointer-events:none so elementFromPoint never sees it. */
export function clickAt(at: BlobPoint): void {
  if (typeof document === "undefined") return;
  const el = document.elementFromPoint(at.x, at.y);
  if (!el || !(el instanceof HTMLElement)) return;
  const target = el.closest(CLICKABLE) ?? el;
  if (!(target instanceof HTMLElement)) return;
  // Tapping a field focuses it (mobile-tap semantics); everything else gets
  // a real click so React onClick / details-toggle all fire normally.
  if (target.matches("input,textarea,select,[contenteditable]")) {
    target.focus();
    return;
  }
  target.click();
}

/** Recenter signal: gaze clients reset neutral to the current pose and snap
 *  the published point to viewport center. Dispatched by handleRecenterKey,
 *  consumed by the gaze provider — keys stay owned here, sensing stays there. */
export const RECENTER_EVENT = "gaze:recenter";

const TYPING = "input,textarea,select,[contenteditable]";

/** R key: recenter gaze. Returns true when consumed. Typing fields exempt. */
export function handleRecenterKey(e: KeyboardEvent): boolean {
  if (e.code !== "KeyR" || e.metaKey || e.ctrlKey || e.altKey) return false;
  const ae = document.activeElement;
  if (ae && ae !== document.body && ae instanceof HTMLElement && ae.matches(TYPING)) {
    return false; // typing r must type r
  }
  e.preventDefault();
  window.dispatchEvent(new CustomEvent(RECENTER_EVENT));
  return true;
}

/** True while a spacebar hold owns the mic session it started. */
let micHeld = false;

function micLive(): boolean {
  return (
    document
      .querySelector("#mic-toggle:not([disabled])")
      ?.getAttribute("aria-pressed") === "true"
  );
}

/** Global spacebar router (keydown). Returns true when consumed. */
export function handleSpacebar(e: KeyboardEvent, at: BlobPoint): boolean {
  if (e.code !== "Space") return false;
  // Hold-to-repeat must not re-fire mic starts or double-click.
  if (e.repeat) {
    e.preventDefault();
    return true;
  }
  const ae = document.activeElement;
  if (ae && ae !== document.body && ae instanceof HTMLElement && ae.matches(NATIVE_FOCUS)) {
    return false; // focused control: let the browser activate/type natively
  }
  const mic = document.querySelector<HTMLButtonElement>("#mic-toggle:not([disabled])");
  if (mic) {
    // Connected project page: push-to-talk. Start only when off, so a
    // mouse-started session is never inverted by the key.
    e.preventDefault();
    if (!micLive()) {
      mic.click();
      micHeld = true;
    }
    return true;
  }
  e.preventDefault();
  clickAt(at);
  return true;
}

/** Push-to-talk release. Stops only the session the hold started; releasing
 *  finalizes the buffered utterance (submit), never discards. */
export function handleSpacebarUp(e: KeyboardEvent): boolean {
  if (e.code !== "Space") return false;
  if (!micHeld) return false;
  micHeld = false;
  const mic = document.querySelector<HTMLButtonElement>("#mic-toggle:not([disabled])");
  if (mic && micLive()) {
    e.preventDefault();
    mic.click();
  }
  return true;
}
