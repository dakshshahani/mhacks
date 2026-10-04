// Electron main (phase 2: standalone shell — services live here, no harness).
//
// Owns: app/window lifecycle, media permission grants, navigation guards,
// webview guest tracking, all main-side services (git/speech/pipeline/Jev
// wiring in services.ts). Does NOT own: intent/target/route decisions (Dev B
// orchestrator, composed in decideHandler.ts).
//
// Renderer loads via loadFile (APP_URL override kept as a dev escape hatch).
// The browser harness (pnpm dev) is unaffected — it never imports this file.

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { BrowserWindow as BrowserWindowType, Event as ElectronEvent } from "electron";
import { electron } from "./electron";
import {
  appRoot,
  resolveDemoRoot,
  resolveGuestPreload,
  resolveIndexHtml,
  resolvePreload,
  resolveProbeSource,
} from "./paths";
import { createServices, type DemoServices, type ShellEvent } from "./services";
import { PreviewManager } from "./preview";
import { createDecideHandler } from "./decideHandler";
import { bootPackagedFullApp, stopSupervised } from "./fullapp";
import { registerBridge, sendToShell } from "./ipcBridge";
import { installMenu } from "./chrome";
import { createKeyStore } from "./keyStore";

const { app, BrowserWindow, session, shell } = electron;

const APP_URL_OVERRIDE = process.env.APP_URL ?? null;

// Headless QA hook (dev + packaged): MHACKS_CDP_PORT=9335 exposes the
// debugger endpoint for scripted verification (targets, probe, edits).
// Never set in production use; no UI depends on it.
if (process.env.MHACKS_CDP_PORT) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env.MHACKS_CDP_PORT);
}

let win: BrowserWindowType | null = null;
let svc: DemoServices | null = null;
let previewManager: PreviewManager | null = null;

function getWindow(): BrowserWindowType | null {
  if (win && !win.isDestroyed()) return win;
  const [first] = BrowserWindow.getAllWindows();
  return first ?? null;
}

function emitToShell(event: ShellEvent): void {
  const channel =
    event.type === "pipeline"
      ? "pipeline:state"
      : event.type === "speech-state"
        ? "speech:state"
        : "speech-transcript";
  const payload =
    event.type === "pipeline"
      ? event.state
      : event.type === "speech-state"
        ? event.state
        : event.event;
  sendToShell({ getWindow }, channel, payload);
}

function isFirstParty(url: string): boolean {
  if (url.startsWith("file://")) return true;
  if (APP_URL_OVERRIDE) {
    try {
      return url.startsWith(new URL(APP_URL_OVERRIDE).origin);
    } catch {
      return false;
    }
  }
  return url.startsWith("http://localhost:") || url.startsWith("http://127.0.0.1:");
}

function grantMedia(): void {
  // Device + clipboard grants for first-party pages (the window hosts the
  // Next frontend + shell page; the preview webview guest is same-origin
  // through the harness proxy or data: URLs). Everything else denied+logged.
  // "media" covers getUserMedia (mic capture, head tracking); the clipboard
  // entries cover copy buttons (share preview URL, copy code) — without
  // them navigator.clipboard.writeText rejects with "Write permission denied".
  const GRANTED = new Set([
    "media",
    "microphone",
    "camera",
    "clipboard-read",
    "clipboard-write",
    "clipboard-sanitized-write",
  ]);
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const url = webContents.getURL();
    if (isFirstParty(url) && GRANTED.has(permission)) {
      callback(true);
      return;
    }
    console.warn(`[electron] denied permission "${permission}" for ${url}`);
    callback(false);
  });
}

type WindowTarget = { url: string } | { file: string };
let lastTarget: WindowTarget | null = APP_URL_OVERRIDE ? { url: APP_URL_OVERRIDE } : null;

function createWindow(target: WindowTarget): void {
  lastTarget = target;
  win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: "gaze",
    backgroundColor: "#0b0e14",
    // Frameless overlay: no native title bar — the page provides drag
    // regions (-webkit-app-region, see index.html + frontend globals.css).
    // Traffic lights float over content top-left; frame stays for shadow,
    // rounded corners and resizing.
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: resolvePreload(),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event: ElectronEvent, url: string) => {
    if (isFirstParty(url)) return;
    event.preventDefault();
    void shell.openExternal(url);
  });
  win.webContents.on(
    "did-fail-load",
    (_event: ElectronEvent, code: number, desc: string, url: string) => {
      console.error(`[electron] failed to load ${url}: ${code} ${desc}`);
    },
  );
  // Renderer console → main stdout. Object-form event (Electron 32+: the
  // positional (level, message, line, sourceId) args are deprecated and
  // misread). Warnings+ carry real breakage signal — info/debug stay in
  // DevTools.
  win.webContents.on("console-message", (event: ElectronEvent) => {
    const { level, message, lineNumber, sourceId } = (event ?? {}) as unknown as {
      level?: number;
      message?: string;
      lineNumber?: number;
      sourceId?: string;
    };
    if ((level ?? 0) >= 2) console.error(`[renderer:${sourceId}:${lineNumber}] ${message}`);
  });
  win.on("closed", () => {
    win = null;
  });

  if ("url" in target) {
    const url = target.url;
    void win.loadURL(url).then(() => {
      console.log(`[electron] window loaded ${url}`);
    });
  } else {
    void win.loadFile(target.file).then(() => {
      console.log("[electron] shell loaded from bundle");
    });
  }
}

function hardenGuests(): void {
  // Preview webviews render project content: no popups; tracked so the
  // preview manager can drive probe queries + data: URL loads.
  app.on("web-contents-created", (_event, contents) => {
    if (contents.getType() === "webview") {
      contents.setWindowOpenHandler(() => ({ action: "deny" }));
      previewManager?.attachGuest(contents);
    }
  });
}

async function bootDemoShell(): Promise<void> {
  const demoRoot = resolveDemoRoot();
  console.log(`[electron] demo root: ${demoRoot} (app root: ${appRoot})`);
  svc = await createServices(demoRoot, emitToShell);
  previewManager = new PreviewManager({
    preview: svc.preview,
    demoRoot,
    readProbeSource: () => readFile(resolveProbeSource(), "utf8"),
  });
  const decide = createDecideHandler(svc);
  const manager = previewManager;
  registerBridge({
    router: svc.router,
    speech: svc.speech,
    decide,
    reloadPreview: () => manager.reload(),
    guestPreloadURL: () => pathToFileURL(resolveGuestPreload()).href,
    getWindow,
  });
  const keys = await createKeyStore();
  void keys;
}

// Single instance: a second launch focuses the running shell instead of
// splitting snapshot stores across two processes.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const first = getWindow();
    if (first) {
      if (first.isMinimized()) first.restore();
      first.focus();
    }
  });

  void app.whenReady().then(async () => {
    installMenu();
    grantMedia();
    hardenGuests();
    if (APP_URL_OVERRIDE) {
      // Dev launcher full-app: servers supervised outside; window only.
      createWindow({ url: APP_URL_OVERRIDE });
      return;
    }
    if (process.env.MHACKS_SHELL_ONLY === "1") {
      // Template-only demo shell (file:// index.html + in-main services).
      await bootDemoShell();
      createWindow({ file: resolveIndexHtml() });
      return;
    }
    // Packaged full-app: supervise harness + frontend, window on landing.
    const { frontendUrl } = await bootPackagedFullApp();
    createWindow({ url: frontendUrl });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      // Re-create targets depend on boot mode; packaged reloads frontend via
      // stored URL, shell-only reloads the file.
      if (lastTarget) createWindow(lastTarget);
    }
  });
  app.on("before-quit", () => {
    // Release the file watcher; snapshots already persist on disk.
    void svc?.devServer.stop().catch(() => undefined);
    stopSupervised();
  });
}
