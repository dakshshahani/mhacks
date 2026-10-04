// Filesystem roots (E10: template-only packaged app).
//
// Dev: everything resolves into the repo checkout (appRoot = apps/desktop).
// Packaged: the demo template is seeded from extraResources into userData on
// first run (resourcesPath is read-only on real installs; snapshots must be
// writable), and the guest preload + probe ship as extraResources files.
// NOTE: main runs TS sources in place (no build step); appRoot assumes
// src/main/<file>.ts at runtime.

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, cpSync } from "node:fs";
import { electron } from "./electron";

const { app } = electron;
const here = dirname(fileURLToPath(import.meta.url));
// appRoot = package dir in both modes: src/main/*.ts at typecheck time,
// dist-electron/main.mjs bundled at runtime. esbuild preserves import.meta.url
// per output file, so this detects its own layout.
export const appRoot = here.endsWith(join("src", "main"))
  ? join(here, "..", "..")
  : join(here, "..");

/** preload.cjs: bundle output dir (dev build and packaged alike). */
export function resolvePreload(): string {
  const cand = join(appRoot, "dist-electron", "preload.cjs");
  if (!existsSync(cand)) throw new Error(`preload not found at ${cand} (run build:main)`);
  return cand;
}

function resourcesPath(): string {
  return process.resourcesPath;
}

/** Writable demo template root (snapshots live beside it). */
export function resolveDemoRoot(): string {
  if (!app.isPackaged) return join(appRoot, "demo");
  const dest = join(app.getPath("userData"), "demo-template");
  if (!existsSync(dest)) {
    mkdirSync(app.getPath("userData"), { recursive: true });
    cpSync(join(resourcesPath(), "demo"), dest, { recursive: true });
    console.log(`[electron] seeded demo template → ${dest}`);
  }
  return dest;
}

/** Guest preload file for the preview <webview> (must be a real file). */
export function resolveGuestPreload(): string {
  if (!app.isPackaged) return join(appRoot, "src", "guest", "preview-preload.js");
  return join(resourcesPath(), "guest", "preview-preload.js");
}

/** probe.js source, inlined into generated preview HTML (data: URLs have no
 *  server to serve a <script src> from). */
export function resolveProbeSource(): string {
  if (!app.isPackaged) return join(appRoot, "src", "probe.js");
  return join(resourcesPath(), "guest", "probe.js");
}

/** Shell page for loadFile. */
export function resolveIndexHtml(): string {
  return join(appRoot, "index.html");
}
