'use client';

/* Gaze blob: a liquid-glass bubble that marks the pointer everywhere.
 * A SKIN over the existing gaze/mouse input — it renders a position, never
 * decides one (dwell, smoothing policy, and Jev disambiguation live where
 * they already live). Position = fresh gaze point when a gaze client
 * publishes window.__gazePoint (see lib/blob-input.ts), else the mouse.
 *
 * True SVG-displacement lens (feTurbulence + feDisplacementMap through
 * backdrop-filter:url): real refraction in Chromium, frosted-blur fallback
 * everywhere else (see globals.css declaration order). Static turbulence —
 * no animated noise, so the 40px surface stays cheap at 60fps. rAF lerp
 * smooths; hover grows the bubble over clickables. pointer-events:none so
 * it never blocks elementFromPoint. Mounted once in layout.tsx so it covers
 * every page. Cursor suppression lives in globals.css (.blob-on);
 * reduced-motion keeps the native cursor and only the spacebar router stays
 * active. */

import { useEffect, useRef } from "react";
import { gazePoint, handleRecenterKey, handleSpacebar, handleSpacebarUp } from "../lib/blob-input";

// Mouse is snappy; gaze glides — letting go of the mouse eases the orb back
// to the gaze point instead of snapping.
const MOUSE_LERP = 0.35;
const GAZE_LERP = 0.08;
const HOT_SCALE = 1.35;
const CLICKABLE = "a,button,[role=button],summary,input,select,textarea,[contenteditable]";

export default function Blob() {
  const el = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Project pages split the inputs: the native cursor navigates (visible),
    // the orb follows gaze only. Everywhere else the orb IS the cursor, so
    // the OS one hides. Native cursor also stays under reduced motion.
    let wasProject: boolean | null = null;
    let raf = 0;
    let tx = window.innerWidth / 2;
    let ty = window.innerHeight / 3;
    let cx = tx;
    let cy = ty;
    let shown = false;
    // Last-active input wins: a drifted gaze must not drag the bubble away
    // from the mouse you are currently moving (the OS cursor is hidden, so
    // the bubble IS the cursor while mousing). Gaze takes over after the
    // mouse idles out.
    let lastMouseAt = 0;
    const MOUSE_IDLE_MS = 1000;

    const onMove = (e: MouseEvent) => {
      tx = e.clientX;
      ty = e.clientY;
      lastMouseAt = performance.now();
    };
    const onKey = (e: KeyboardEvent) => {
      if (handleSpacebar(e, { x: cx, y: cy })) return;
      handleRecenterKey(e);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      handleSpacebarUp(e);
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);

    const tick = () => {
      raf = window.requestAnimationFrame(tick);
      // Project pages split the inputs: the native cursor navigates
      // (visible), the orb follows gaze/highlight only and never the mouse.
      // Everywhere else the orb is the cursor — last-active input wins with
      // a slow glide back to gaze once the mouse idles out.
      const projectPage = document.querySelector("main.hifi-project") !== null;
      if (projectPage !== wasProject) {
        wasProject = projectPage;
        document.documentElement.classList.toggle("blob-on", !reduced && !projectPage);
      }
      const g = gazePoint();
      const mouseLive = performance.now() - lastMouseAt < MOUSE_IDLE_MS;
      const onGaze = g !== null && (projectPage || !mouseLive);
      const k = onGaze ? GAZE_LERP : MOUSE_LERP;
      const dx = onGaze && g ? g.x : tx;
      const dy = onGaze && g ? g.y : ty;
      cx += (dx - cx) * k;
      cy += (dy - cy) * k;
      if (!shown) {
        shown = true;
        node.classList.add("blob-show");
      }
      const under = document.elementFromPoint(cx, cy);
      const hot =
        under instanceof HTMLElement && (under.closest(CLICKABLE) ?? under) instanceof HTMLElement;
      const s = hot ? HOT_SCALE : 1;
      node.style.transform = `translate3d(${cx.toFixed(1)}px,${cy.toFixed(1)}px,0) scale(${s})`;
    };
    raf = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      document.documentElement.classList.remove("blob-on");
      wasProject = null;
    };
  }, []);

  return (
    <>
      {/* Refraction engine: smooth noise field displaces backdrop pixels like
          curved glass. Static (no animation) by design — cheap at 60fps.
          The 0x0 host must NOT be display:none or Chromium drops the filter.
          color-interpolation-filters=sRGB keeps neutral gray truly neutral
          (linearRGB would inject phantom displacement everywhere). */}
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <filter
          id="blob-lens"
          x="-30%"
          y="-30%"
          width="160%"
          height="160%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="7" result="noise" />
          <feGaussianBlur in="noise" stdDeviation="1" result="soft" />
          <feDisplacementMap in="SourceGraphic" in2="soft" scale="14" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
      <div ref={el} aria-hidden="true" className="blob" />
    </>
  );
}
