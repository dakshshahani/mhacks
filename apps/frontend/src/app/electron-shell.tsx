// Frameless-shell marker (Dev C seam: main hides the native title bar).
// Sets data-electron-shell on <html> when running inside the Electron
// window (window.mhacksNative is preload-exposed there, absent in browsers).
// Effect (post-hydration) on purpose: the preload CANNOT set this before
// hydration — an imperative pre-hydration attribute on <html> trips React's
// hydration-mismatch overlay (it compares SSR HTML). Post-commit DOM writes
// are invisible to the check. Desktop index.html (no React) keeps getting
// the marker from preload instead — see preload.cjs.
"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    mhacksNative?: { isElectron?: () => boolean };
  }
}

export default function ElectronShell() {
  useEffect(() => {
    try {
      if (typeof window !== "undefined" && window.mhacksNative?.isElectron?.()) {
        document.documentElement.setAttribute("data-electron-shell", "");
      }
    } catch {
      // Marker is cosmetic (drag regions); never break the page for it.
    }
  }, []);
  return null;
}
