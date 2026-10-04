# Electron port — macOS (.app) plan

> Branch: `electron-port` · Owner: Dev C (shell)
> Status: **full-app mode** — `dev:electron` supervises harness + Next and
> opens landing → gallery → workspace in one window. Verified 2026-10-04:
> gallery scan (10 projects), demo click → edit → undo, all in-window.
> Phase-2 standalone shell kept via `MHACKS_SHELL_ONLY=1`.

## 0a. Full-app mode (what `dev:electron` runs today)

`scripts/run-electron.mjs` supervises three processes: harness API server
(`dev-server.mjs`, full backend: pipeline/git/supervision/proxy/SSE),
Next frontend (`apps/frontend`, landing → gallery → workspace, rewrites
`/api/*` + `/harness/*` to `HARNESS_URL`), and the Electron shell pointed
at the frontend. The shell is a thin host here (window + media grants + nav
guards + Keychain); all product behavior comes from frontend + harness,
which is why no feature was cut: gallery scan/open, demo + foreign-project
edits, undo/history, mic + Scribe fallback all flow through unchanged.

- **Attach, don't duplicate**: healthy `:5173` / `:3000` are reused and left
  running on quit (ownership tracked; only spawned children are killed).
  Next 16 takes a dev lockfile per dir — a second `next dev` in
  apps/frontend always exits, so busy-but-foreign ports fail loudly with
  guidance instead of half-wiring.
- **Packaged full-app VERIFIED** (`gaze-0.0.1-arm64.dmg`, signed Developer ID,
  2026-10-04): supervised harness + Next standalone + window from a clean
  userData seed — gallery scan, demo click → edit → undo, repo tree
  untouched (edits land in userData copy). Product name **gaze**, arm64
  only; appId stays ai.mhacks.desktop (Keychain/TCC continuity).
- **Phase-2 standalone shell** (`MHACKS_SHELL_ONLY=1`, file:// index.html,
  in-main demo services, esbuild bundle) remains for template-only work and
  as the packaged-shape reference. Its verification is kept below (§0b).

Lessons — read before touching this code (each cost real debugging time):
0. **The window must load `localhost`, never `127.0.0.1`.** On 127.0.0.1 the
   Next/Turbopack dev runtime silently never hydrates (SSR HTML renders,
   zero React roots, zero errors — proven by fiber probe; HMR socket fails
   with ERR_INVALID_HTTP_RESPONSE). Server-to-server URLs stay 127.0.0.1.

`pnpm --filter @mhacks/desktop dev:electron` builds `dist-electron/main.mjs`
(esbuild, ~0.2s) and opens the shell on its own services. No harness server.
`pack:dir` ships the same bundle + plain-JS renderer in asar (+ unpacked
`demo`/`guest` extraResources). Renderer talks to main through
`window.mhacksNative` (contract channels via allowlisted `invoke`, local
channels via named methods); the harness fetch/SSE path is a fallback in
`src/transport.js`, so `pnpm dev` (browser) keeps working unchanged.

- New main modules: `services.ts` (router/git/speech/pipeline/Jev/gate),
  `preview.ts` (template → data: URL, guest probe queries), `decideHandler.ts`
  (demo decide-and-edit, HTTP-shaped `{status, body}`), `scribe.ts` (key stays
  in main), `ipcBridge.ts`, `paths.ts` (userData seed), `chrome.ts` (menu).
- Renderer: `transport.js`, `preview-embed.js` handshake (`preload` attr →
  `about:blank` → `preview:reload`), gaze `acceptProbeReply` (additive).
- Shell is template-only (E10-A): main ignores `project`; gallery/proxy stay
  harness-only. CSP meta covers both modes incl. `wasm-unsafe-eval` for the
  MediaPipe bundle.

Lessons — read before touching this code (each cost real debugging time):
1. **Type stripping genuinely fails for TS physically under `node_modules/`**
   (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, all runtimes). Dev hid it
   because pnpm symlinks resolve outside `node_modules`. Hence the esbuild
   main bundle (only `electron` external). Proven by extracting app.asar to a
   plain dir and watching the import throw.
2. **`ELECTRON_RUN_AS_NODE=1` leaks from Electron-based hosts** (agent
   shells) and silently downgrades the binary to plain node: `require /
   import "electron"` returns the path shim, `--remote-debugging-port` says
   "bad option", asar runs misbehave. The launcher scrubs it; **manual binary
   probes must `env -u` it or every conclusion is wrong.**
3. **Silent hang + empty stderr = startup error dialog** (`NSAlert runModal`;
   confirm with `sample <pid>`). stderr shows nothing. Read the dialog via a
   sighted teammate or bisect with the extracted-asar technique above.
4. **No-guest deadlock**: a src-less webview creates no guest WebContents, so
   main must pend loads AND the renderer must kick off navigation
   (`about:blank`) — both sides implemented, either order safe.
5. **Background launches die between tool calls** — verify long-lived apps
   with `nohup … & disown` and test within the same invocation.
6. **CDP in packaged apps**: the renamed binary rejects Chromium flags; use
   the `MHACKS_CDP_PORT` env hook (`app.commandLine.appendSwitch`).
7. **Camera/mic prompts need TWO grants + a signed host.** Chromium-level
   (`setPermissionRequestHandler`, app.ts) AND macOS TCC
   (`systemPreferences.askForMediaAccess`, `shell:ensureMediaAccess`,
   asked at mic-toggle and page load via `transport.ensureMediaAccess`).
   Verified wiring in dev: `[electron] media access camera:
   not-determined → not-determined`. That flat line is EXPECTED unsigned:
   the dev Electron.app (node_modules) has no `NSCameraUsageDescription` /
   `NSMicrophoneUsageDescription`, so TCC never prompts. The packaged build
   carries both strings (`extendInfo`); the prompt appears there once
   signed (Developer ID). Do not "fix" dev by editing node_modules'
   Info.plist (breaks the ad-hoc signature, uncommittable, gone on
   reinstall).
   OUTCOME (verified in signed `pack:dir` .app): camera + mic `getUserMedia`
   both GRANT and capture works end-to-end. Note: `getMediaAccessStatus`
   may still read `not-determined` afterwards — cosmetic only, nothing
   gates on it (the real gate is the getUserMedia call itself, which our
   permission handler allows). If prompts never appear even signed, check:
   entitlements in signature (`codesign -d --entitlements`), usage strings
   in Info.plist, and Gatekeeper acceptance (`spctl -a`) — an
   UNNOTARIZED rejection can suppress TCC prompts, which is the next reason
   to finish notarization.
8. **Frameless window**: `titleBarStyle: "hidden"` + `trafficLightPosition`
   in main; drag regions via `-webkit-app-region` gated on
   `html[data-electron-shell]` (preload sets it on every document;
   interactives get `no-drag`). Landing/gallery headers already clear the
   lights; `.workspace-header` reserves 76px left. No padding hacks in JS.
9. **Packaged frontend = standalone + static + NODE_PATH dodge.**
   `output: "standalone"` (dev ignores it); the Docker pattern applies:
   copy `.next/static` (+ `public/`) alongside or every chunk 404s and React
   never hydrates (stuck spinners, zero errors). Stage via
   `scripts/stage-frontend.mjs`: `pnpm deploy --legacy --prod` (complete
   closure — Next's own trace omits @swc/helpers/@next/env under pnpm) +
   standalone payload overlay. electron-builder silently drops
   `node_modules` from extraResources → ship as `frontend-deps` +
   `NODE_PATH` (CJS server only). pnpm self-links (`.pnpm/.../@mhacks`)
   must be deleted (dangle → codesign ENOENT), never followed (gigabytes).
10. **Flaky renderer loss under load**: packaged window occasionally loses
    its renderer (0 CDP targets, process alive) on this loaded machine;
    relaunch recovers. Do not chase it as an app bug unless it reproduces
    on a quiet machine — verify promptly after launch.
11. **Stuck-spinners checklist** (gallery/workspace never resolve): (a) API
    reachable in-page? (b) fibers present (`__react*` keys)? (c) chunk
    statuses in resource timing? This exact sequence found the missing
    static payload above.

## 0b. Phase 1 as built (superseded — harness-backed shell)

`pnpm --filter @mhacks/desktop dev:electron` (`scripts/run-electron.mjs`):
spawns the unchanged harness on a free port (5173, else walk-up), waits for
it, opens the Electron shell on it. The pipeline (Jev/orchestrator/executor)
still runs in `dev-server.mjs`; Electron owns window + `<webview>` preview +
media grants + nav guards + Keychain store. Verified headless:

- CDP `/json/list` shows `page` (shell) + `webview` (demo preview document).
- Guest `window.__gazeProbe.queryElementAt(60,60)` → `Hero`, locked `Hero`
  (the real Dev A probe, not the canned stub).
- Guest click → `sendToHost` → shell `#point: "Hero — send an edit to apply"`.
- In-shell `sendEdit('make it brand')` → `Done: Hero: color → brand
  (Hero.tsx @ …) — undo within 5s`; `git:undo` reverts; demo tree clean.
- Zero renderer errors; `tsc` strict green; shell 45 + desktop 7 tests pass.

Files added: `src/main/{index,app,keyStore}.ts`, `src/preload/preload.cjs`,
`src/guest/preview-preload.js`, `src/preview-embed.js`,
`scripts/run-electron.mjs`, `build/entitlements.mac.plist`,
`electron-builder.yml`, `packages/shell/.../safeStorage*` Keychain backend +
tests. Touched: `index.html` (webview element), `renderer.js` (embed branch,
extracted `handlePreviewFrame`), `gaze/controller.js` (+`acceptProbeReply`),
`dev-server.mjs` (preload-path injection only).

Lessons (do not regress):
- `.ts` main loads via Node's default ESM loader: bare `import … from
  "electron"` hits the path-shim. Use `createRequire` + `as typeof
  import("electron")`, `import type` for annotations (E7 pattern in
  `src/main/*.ts`). Preload must be plain CJS (`preload.cjs`;
  sandboxed preload only guarantees `require("electron")`).
- Scrub `ELECTRON_RUN_AS_NODE` when spawning the shell — agent/CI hosts
  (Electron-based) leak it and silently downgrade the shell to plain node.
- `console-message` needs the object-form params (Electron 32+).
- `run-electron.mjs` never steals :5173: walks up when busy.
- CDP verify via `ELECTRON_EXTRA_ARGS="--remote-debugging-port=PORT"`.
> Sources of truth: `AGENTS.md §5,7` (seams, git-as-buttons), `docs/dev-c.md §9`
> (why Electron is last), `docs/grill-decisions.md` (overrides PRD),
> `packages/contracts/src/ipc.ts` (channel shapes), `packages/shell/src/*` (services).
> Read `docs/dev-c.md` first — this doc is the Electron *appendix* to it, not a replacement.

## 0. Goal and non-goals

**Goal:** `apps/desktop` runs as a signed macOS `.app` (Apple Silicon + Intel)
with zero changes to the look→speak→edit→undo loop. The browser harness
(`pnpm --filter @mhacks/desktop dev` → `dev-server.mjs` on `:5173`) keeps
working throughout — Electron is additive, per `dev-c.md §3.1`.

**Non-goals (locked, do not relitigate here):**

- No decision logic moves into main/preload. Intent/target/route stay in
  `@mhacks/orchestrator`; main only hosts `IpcRouter` and forwards envelopes.
- No Confirm dialogs. Auto-apply + 5s undo circle + `git:undo` (grill-locked).
- No import-site/URL feature, no TTS resurrection, no billing backend.
  BYOK is a display-only key field + Keychain storage.

**How to read this doc:** Tasks E1–E14 are ordered by dependency. Each has
**Files**, **Steps**, **Acceptance**. Work top-down; each task lands with the
harness still green (`tsc --noEmit`, existing tests, manual harness click-through).

---

## 1. Target architecture

```
┌─ Main process (Node, trusted) ─────────────────────────────┐
│ src/main/index.ts                                           │
│  app lifecycle · BrowserWindow · Menu/dock · permissions    │
│  owns: FileGitService · IpcRouter · DevServerManager        │
│        SpeechService (state) · safeStorage backend          │
│  exposes: ipcMain.handle(<IpcChannelMap invoke channel>)    │
└──────────────┬────────────────────────────┬────────────────┘
               │ contextBridge (preload)    │ <webview> guest
┌─ Renderer ───┴────────────┐  ┌────────────┴─────────────────┐
│ window.mhacks.invoke()    │  │ guest preload: probe.js      │
│ existing renderer.js /    │  │ Dev A queryElementAt(x, y)   │
│ React shell (no node)     │  │ [data-gaze-overlay] excluded │
└───────────────────────────┘  └──────────────────────────────┘
```

Key moves, and why they are safe:

| Today (harness) | Electron target | Why safe |
|---|---|---|
| `dev-server.mjs` creates `IpcRouter` + calls `router.invoke(...)` in-process | Main creates the **same** `IpcRouter`, bridges it via `ipcMain.handle` | `IpcRouter` is transport-agnostic (`packages/shell/src/ipcRouter.ts`); zero channel logic changes |
| Renderer uses `fetch(/api/invoke)` + SSE | Renderer uses `window.mhacks.invoke(channel, req)` + `onEvent` subscriptions | Same `IpcChannelMap` shapes, same `IpcResult` envelopes |
| `<iframe id="preview">` + HTTP proxy injects `probe.js` | `<webview>` + guest preload runs the probe; main relays `preview:queryElementAt` via `executeJavaScript` | `PreviewHost` interface unchanged; only `setProbe()` wiring changes |
| `createMemoryKeyStore()` | Electron `safeStorage` backend, memory fallback in harness | Same `KeyStore` interface |
| `pnpm dev` spawned with system `pnpm` | Dev: same. Packaged: template-only or bundled node (E10 decides) | `DevServerManager` API unchanged |

---

## 2. Task breakdown

### E1 — Dependencies and package scripts

**Why:** nothing else compiles without the runtime.

**Files:**

- `apps/desktop/package.json` (edit)
- `pnpm-workspace.yaml` (no change expected)

**Steps:**

1. Add devDeps: `electron@^36`, `electron-builder@^25` (pick **one** packager;
   recommendation: `electron-builder` — DMG + notarize hook + `extraResources`
   are one config file; `forge` needs more plugins for the same).
2. Add scripts:
   ```json
   {
     "dev:electron": "electron .",
     "dist:mac": "electron-builder --mac",
     "pack:dir": "electron-builder --mac --dir"
   }
   ```
3. Set `"main": "dist/main/index.js"` (compiled output, never source).

**Acceptance:**

- [ ] `pnpm --filter @mhacks/desktop exec electron --version` prints a version.
- [ ] Harness scripts (`dev`, `check`, `test`) unchanged and green.

---

### E2 — Main process: app lifecycle + window

**Why:** every packaged failure we fear (zombie dev-servers, dock-icon limbo,
second-instance confusion) lives here.

**Files (new):**

- `apps/desktop/src/main/index.ts` — `app.whenReady`, `BrowserWindow`, quit handling.
- `apps/desktop/src/main/services.ts` — constructs `FileGitService`,
  `PreviewHost`, `SpeechService`, `IpcRouter`, `DevServerManager` (extracted so
  `dev-server.mjs` and main share construction, not copy-paste).

**Steps:**

1. `app.whenReady()` → create window → load renderer (E6 switch):
   ```ts
   const win = new BrowserWindow({
     width: 1280, height: 860,
     webPreferences: {
       preload: join(__dirname, "../preload/preload.js"),
       contextIsolation: true, sandbox: true,
       nodeIntegration: false, webviewTag: true,
     },
   });
   if (process.env.VITE_DEV_SERVER_URL) await win.loadURL(process.env.VITE_DEV_SERVER_URL);
   else await win.loadFile(join(__dirname, "../renderer/index.html"));
   ```
2. macOS lifecycle (all three, no shortcuts):
   - `app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); })`
   - `app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); })`
   - `app.on("before-quit", async () => { await devServer.stop(); })` — undo must
     survive restart, but the *child process* must not.
3. `singleInstanceLock`: `app.requestSingleInstanceLock()` + focus existing window
   on `second-instance`. (Prevents two harnesses fighting over one preview port.)
4. Move service construction out of `dev-server.mjs` into `services.ts`; both
   entry points import it. `dev-server.mjs` keeps its HTTP/SSE layer; main does
   not serve HTTP at all.

**Acceptance:**

- [ ] `dev:electron` opens a window; closing it on macOS leaves the dock icon
      (standard); `Cmd-Q` kills dev-server children (no orphan `pnpm dev` in `ps`).
- [ ] Second `electron .` focuses the first window instead of opening another.
- [ ] `tsc --noEmit` green (extend `tsconfig.json` `include` to `src/main`, `src/preload`).

---

### E3 — Preload: the only bridge

**Why:** the single biggest Electron security boundary. Renderer never gets
`node`, `ipcRenderer`, or service handles — only typed `invoke` + event
subscriptions.

**Files (new):**

- `apps/desktop/src/preload/preload.ts`
- `apps/desktop/src/preload/api.d.ts` (renderer-side `window.mhacks` typing)

**Steps:**

1. Expose exactly this surface, nothing more:
   ```ts
   // preload.ts
   import { contextBridge, ipcRenderer } from "electron";
   contextBridge.exposeInMainWorld("mhacks", {
     invoke: (channel: string, req: unknown) => ipcRenderer.invoke(channel, req),
     onEvent: (channel: string, fn: (e: unknown) => void) => {
       const allowed = ["pipeline:state", "speech:transcript", "speech:state"];
       if (!allowed.includes(channel)) throw new Error(`blocked event ${channel}`);
       const l = (_: unknown, v: unknown) => fn(v);
       ipcRenderer.on(channel, l);
       return () => ipcRenderer.removeListener(channel, l);
     },
   });
   ```
2. Renderer client: add `src/renderer/lib/ipc.ts` with an overload-typed wrapper
   over `IpcChannelMap` so `invoke("agent:submitEdit", req)` returns
   `Promise<IpcResult<EditResult>>` at compile time. Keep the existing
   `fetch`-based client behind a `USE_ELECTRON = !!window.mhacks` flag so the
   harness keeps working until E5 lands.

**Acceptance:**

- [ ] Renderer has no `require`, no `process`, no direct `ipcRenderer` import
      (`grep -r ipcRenderer apps/desktop/src/renderer` empty).
- [ ] Unknown event channels throw in preload (test: `onEvent("agent:submitEdit")` throws).

---

### E4 — `ipcMain` ↔ `IpcRouter` bridge

**Why:** this is the "15-minute wrap" `dev-c.md` promises — because the router
already exists.

**Files:**

- `apps/desktop/src/main/ipcBridge.ts` (new, ~40 lines)
- `packages/shell/src/ipcRouter.ts` (no logic change; may need an
  `InvokeChannel[]` export for the bridge to iterate)

**Steps:**

1. In main, after constructing the router via `services.ts`:
   ```ts
   import { ipcMain } from "electron";
   const INVOKE = ["preview:queryElementAt","preview:setCalibration",
     "agent:submitEdit","git:createSnapshot","git:undo","git:confirm",
     "git:history","speech:start","speech:stop"] as const;
   for (const ch of INVOKE) ipcMain.handle(ch, (_e, req) => router.invoke(ch, req));
   // events: router-side subscriptions → win.webContents.send("pipeline:state", s) etc.
   ```
2. Forward the three event channels (`pipeline:state`, `speech:transcript`,
   `speech:state`) with `win.webContents.send`. Never add a fourth without a
   contract PR (Dev B reviews `packages/contracts/`).
3. Keep envelope discipline: bridge never throws; a thrown service error becomes
   `{ ok:false, code:"unknown", message }` (mirror `dev-server.mjs` behavior).

**Acceptance:**

- [ ] Every `IpcChannelMap` invoke channel reachable from the renderer returns
      an `IpcResult` envelope (test matrix: one call per channel, ok + error path).
- [ ] `git:undo` with empty history returns `not-ready` (not a throw, not a hang).

---

### E5 — Preview: `<iframe>` → `<webview>`

**Why:** the only task that changes user-visible behavior. Everything else is
plumbing; this is the gaze path.

**Files:**

- `apps/desktop/index.html` (edit: `<iframe id="preview">` → `<webview id="preview">`)
- `apps/desktop/src/main/previewWebview.ts` (new: `setProbe` wiring)
- Guest preload for the webview (Dev A owns probe logic; Dev C owns hosting —
  agree the file location once, e.g. `apps/desktop/src/guest/probe-preload.js`)

**Steps:**

1. Renderer markup:
   ```html
   <webview id="preview" src="about:blank"
     preload="file://.../guest/probe-preload.js" partition="persist:preview">
   </webview>
   ```
   Keep `partition="persist:preview"` so session/cookies survive restarts but stay
   isolated from the shell.
2. Main wiring — replace the canned-probe `preview.setProbe(...)` from
   `dev-server.mjs` with a webview-backed probe:
   ```ts
   preview.setProbe(async (x, y) => {
     const r = await webview.executeJavaScript(`window.__mhacksProbe(${x}, ${y})`);
     return r as GazeFrame; // PreviewHost re-validates via JSON round-trip
   }, /* ready */ true);
   ```
   `ready` flips true on `did-attach` / `dom-ready`, false on `destroyed` /
   `did-fail-load` (→ `wv-gone`, per contract).
3. Guest preload exposes `window.__mhacksProbe` calling Dev A's
   `queryElementAt` (same function the harness's `probe.js` uses today).
   Overlay exclusion (`[data-gaze-overlay]`) moves with it unchanged.
4. Keep the harness `iframe` path behind the `USE_ELECTRON` flag until the
   webview probe passes the E5 acceptance; then delete the flag.

**Acceptance:**

- [ ] `preview:queryElementAt` returns a `GazeFrame` in the packaged app for the
      4 demo elements (same canned expectations as harness, then live probe).
- [ ] Killing the guest (`webview.reload()` mid-query, bad URL) yields
      `wv-gone`, never a hung `invoke`.
- [ ] Gaze-highlight correctness on the demo ≥80% (demo quality bar, `AGENTS.md §8`).

---

### E6 — Renderer bundling + dev/prod load switch

**Why:** `loadFile` in prod, dev-server URL in dev. Without this the `.app`
ships an empty window.

**Files:**

- `apps/desktop/vite.config.ts` or `electron.vite.config.ts` (new)
- `apps/desktop/src/main/index.ts` (the `VITE_DEV_SERVER_URL` branch from E2)

**Steps:**

1. Add a minimal Vite build for the renderer (`index.html` + `src/renderer.js` +
   styles). No framework migration — bundle what exists.
2. Compile main + preload with `tsc` (or `electron-vite build`) into
   `dist/main`, `dist/preload`; renderer into `dist/renderer`.
3. `.gitignore` already covers `dist/` ✅. `electron-builder` `files` field
   includes only `dist/**` + `demo/**` (template) — never `src/`, never `.env`.

**Acceptance:**

- [ ] `pnpm --filter @mhacks/desktop dev` → harness still serves from source.
- [ ] Packaged `.app` (E9) renders the shell with no dev server running.

---

### E7 — `safeStorage` real backend (BYOK)

**Why:** the current `createMemoryKeyStore()` (`packages/shell/src/safeStorage.ts`)
loses keys on restart and stores them in cleartext. PRD F9 requires
Electron `safeStorage` (OS Keychain).

**Files:**

- `packages/shell/src/safeStorage.ts` (edit: add `createElectronKeyStore`)
- `apps/desktop/src/main/services.ts` (edit: pick backend)

**Steps:**

1. Add (main-process only — `safeStorage` throws in renderer):
   ```ts
   import { safeStorage } from "electron";
   export function createElectronKeyStore(): KeyStore {
     return {
       saveKey: async (s, k) => { await backend.write(s, safeStorage.encryptString(k).toString("base64")); },
       getKey: async (s) => {
         const raw = await backend.read(s); if (!raw) return null;
         try { return safeStorage.decryptString(Buffer.from(raw, "base64")); }
         catch { return null; } // keychain reset / different machine
       },
       deleteKey: (s) => backend.delete(s),
     };
   }
   ```
   Back `backend` with `app.getPath("userData")` file store (never the project dir).
2. Guard: `safeStorage.isEncryptionAvailable()` false (fresh VM, first run) →
   fall back to memory store + log once; surface "restart required" only if PM
   asks for the UI state (contract addition, Dev B review).
3. Harness keeps `createMemoryKeyStore()` — no behavior change in browser.

**Acceptance:**

- [ ] Key survives app restart on a real Mac (write → quit → launch → read).
- [ ] `getKey` after Keychain reset returns `null`, never throws.

---

### E8 — macOS permissions: mic + camera

**Why:** macOS TCC kills `getUserMedia` silently without usage descriptions, and
the hardened runtime needs explicit device entitlements. This is the #1
"works on my laptop, dead on stage" risk.

**Files:**

- `apps/desktop/build/entitlements.mac.plist` (new)
- `apps/desktop/build/Info.plist` additions via `electron-builder.yml` (E9)
- `apps/desktop/src/main/permissions.ts` (new)
- `packages/shell/src/speech.ts` (no change — state machine stays)

**Steps:**

1. Entitlements (`build/entitlements.mac.plist`):
   ```xml
   <dict>
     <key>com.apple.security.device.audio-input</key><true/>
     <key>com.apple.security.device.camera</key><true/>
     <key>com.apple.security.cs.allow-jit</key><true/>
   </dict>
   ```
2. Usage strings (InfoPlist via builder config):
   `NSMicrophoneUsageDescription` = "mhacks listens for your edit commands when you press the mic.",
   `NSCameraUsageDescription` = "mhacks tracks your gaze to find the element you're looking at."
3. Gate `speech:start` in main before delegating to `SpeechService`:
   ```ts
   import { systemPreferences } from "electron";
   if (process.platform === "darwin" && systemPreferences.getMediaAccessStatus("microphone") !== "granted")
     await systemPreferences.askForMediaAccess("microphone");
   ```
   Camera gate lives at gaze-tracker init (Dev A call site, same API with `"camera"`).
4. Mic-off / camera-off demo path keeps working: click override only (dev-c.md
   §8 checklist item — rehearse it, don't just assert it).

**Acceptance:**

- [ ] Fresh macOS profile: first `speech:start` triggers the OS mic prompt with
      our string; deny → `not-ready` envelope + mic chip shows off (no crash).
- [ ] Same for camera at tracker init.
- [ ] Full demo runs mic-off/camera-off via click override.

---

### E9 — Packaging, signing, notarization (Mac)

**Why:** an unsigned `.app` is blocked by Gatekeeper on any machine but ours.
Demo-day laptops are never ours.

**Files (new):**

- `apps/desktop/electron-builder.yml`
- `apps/desktop/build/entitlements.mac.plist` (from E8)
- `apps/desktop/build/icon.icns`

**Steps:**

1. Minimal config:
   ```yaml
   appId: ai.mhacks.desktop
   productName: mhacks
   directories: { output: release, buildResources: build }
   files: ["dist/**", "demo/**", "package.json"]
   asar: true
   mac:
     category: public.app-category.developer-tools
     target: [{ target: dmg, arch: [arm64, x64] }]
     hardenedRuntime: true
     gatekeeperAssess: false
     entitlements: build/entitlements.mac.plist
     entitlementsInherit: build/entitlements.mac.plist
     notarize: true
   ```
2. Signing prerequisites (runbook, not code): `Developer ID Application`
   cert in keychain, `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` /
   `APPLE_TEAM_ID` in CI env or `~/.env` (never committed — `.gitignore`
   already covers `.env` ✅).
3. Commands: `pack:dir` (unsigned, fast iteration) → `dist:mac` (signed DMG).
   Test Gatekeeper locally: `spctl -a -vvv <.app>` + launch on a second Mac
   (or fresh user) before calling it done.

**Acceptance:**

- [ ] `pack:dir` produces a launchable `.app` on the build machine.
- [ ] Signed DMG passes `spctl -a` and opens on a Mac that never saw the repo.
- [ ] `release/` artifacts gitignored (extend `.gitignore` with `release/`).

---

### E10 — Dev-server + git binaries in the packaged app

**Why:** `DevServerManager.start({ command: "pnpm", args: ["dev", ...] })`
assumes a dev machine. A judge's Mac has no `pnpm`, no repo `node_modules`.

**Decision (pick one, record it in `grill-decisions.md`):**

| Option | Cost | Fits demo? |
|---|---|---|
| **A. Template-only:** packaged app edits only the bundled `demo/` template (no foreign-project supervision) | ~1h: `resolveRoot` → `process.resourcesPath/demo` | ✅ if demo stays on template |
| **B. Bundle node + run user projects from source** | ~1d: `extraResources`, `node` binary, `npm` bootstrap, PATH surgery | Only if gallery-of-arbitrary-repos is demo-critical |

**Files:**

- `apps/desktop/electron-builder.yml` (`extraResources`)
- `packages/shell/src/devServer.ts` (resolve binary path: `process.resourcesPath/bin/node` in prod, `pnpm` in dev)
- `apps/desktop/src/dev-server.mjs` project-supervision block (keep dev-only under option A)

**Steps (option A):**

1. `extraResources: [{ from: "demo", to: "demo" }]`; at runtime
   `DEMO_ROOT = app.isPackaged ? join(process.resourcesPath, "demo") : <repo demoRoot>`.
2. `FileGitService` root follows `DEMO_ROOT`; snapshots dir follows
   `app.getPath("userData")`, never the read-only `resourcesPath`.
3. Document option B as follow-up; do not half-implement it.

**Acceptance:**

- [ ] Packaged app: edit → build-gate → undo → history all work against the
      bundled template with no `pnpm` on PATH.
- [ ] No writes to `resourcesPath` (read-only on real installs); snapshots land
      in `userData`.

---

### E11 — File watching + HMR truth in the packaged app

**Why:** `EditResult.hotReloaded` must stay truthful (never optimistic).
`fs.watch(..., { recursive: true })` behaves differently on macOS vs Linux, and
`app.asar` paths are not watchable.

**Files:**

- `packages/shell/src/devServer.ts` (edit: watch roots + fallback)

**Steps:**

1. Watch only user-writable dirs (`DEMO_ROOT` from E10, never inside `asar`).
2. macOS `recursive: true` works but coalesces events — keep the existing
   120ms debounce; keep `waitForReload(2000)` semantics.
3. Regression test: apply Tier-1 edit in packaged app → `hotReloaded: true`
   only when the watcher fired; kill watcher → `hotReloaded: false` (honest).

**Acceptance:**

- [ ] Packaged-app Tier-1 edit round-trip <1s file-write→pixels with
      `hotReloaded: true` observed (not assumed).

---

### E12 — App chrome: menu, dock, dialogs, navigation guards

**Why:** default Electron menu says "Electron"; unguarded navigation lets
preview content pop windows or navigate the shell.

**Files:**

- `apps/desktop/src/main/chrome.ts` (new)

**Steps:**

1. Minimal `Menu`: App (About/Hide/Quit), Edit (standard roles so `Cmd-V`
   pastes API keys), View (Reload/Toggle DevTools — dev only), Window.
2. `win.webContents.setWindowOpenHandler(() => ({ action: "deny" }))`;
   `will-navigate` allowlist: dev-server URL + `file://` renderer only.
   External links → `shell.openExternal`.
3. Dock: `app.dock.setIcon`, badge during `editing`/`verifying` (optional, cheap).
4. `dialog.showErrorBox` only for fatal main errors; all pipeline failures stay
   in envelopes + fail card (never OS dialogs for `build-failed`).

**Acceptance:**

- [ ] Paste works in the BYOK field; DevTools absent from prod menu.
- [ ] Clicking a link inside preview opens the browser, never a second window.

---

### E13 — Updater, crash reports, logs (P1 — after first signed build)

**Why:** not demo-critical, but the difference between "a demo .app" and
"an Electron app". Do after E9 works.

**Files:**

- `apps/desktop/src/main/updater.ts`, `apps/desktop/src/main/logging.ts` (new)

**Steps:**

1. `electron-updater` with GitHub releases provider (or S3); check on launch,
   prompt to install on quit. Never force-restart mid-edit.
2. `crashReporter.start({ uploadToServer: false })` initially — local crash
   dumps in `userData`; add a server only if the team wants it.
3. Log main-process output to `userData/logs` (rotate); add "Reveal logs" to
   the menu. `logLines` ring buffer in `DevServerManager` stays as the
   in-app view.

**Acceptance:**

- [ ] Ship → bump version → updater offers the update without data loss.
- [ ] A forced main-process crash leaves a retrievable log.

---

### E14 — Security hardening pass

**Why:** the probe runs page-adjacent JS; Jev is prompt-injectable per
`AGENTS.md §6.4`. Electron must not widen that into RCE.

**Checklist (verify each, not just assert):**

- [ ] `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` on
      shell window AND webview guest (audit `webPreferences` in one place).
- [ ] `webSecurity: true`, no `allowRunningInsecureContent`.
- [ ] CSP `<meta>` on renderer: `default-src 'self'; script-src 'self';
      connect-src 'self' http://localhost:*` (dev) — no `unsafe-inline` for new code.
- [ ] Preload allowlists channels (E3) — no generic `invokeAnything`.
- [ ] `sanitizeFrame` stays server/main-side; guest output re-validated
      (filePath allowlist for demo, re-nulled for foreign — current logic in
      `dev-server.mjs: sanitizeFrame` moves with `services.ts`, unchanged).
- [ ] `ELEVENLABS_API_KEY` never reaches renderer/guest (today's `/api/transcribe`
      keeps the key server-side ✅ — preserve that; in Electron the Scribe call
      stays in main).
- [ ] `npm audit` / `pnpm audit` on new deps; `electron` pinned, updated via PR.

---

## 3. Cut list (what slips if time runs short)

Per `dev-c.md §6` gate rule — cut in this order, never the core loop:

1. E13 (updater/crash) → ship without; manual DMG download.
2. E10-option-B (foreign projects packaged) → template-only packaged app.
3. E12 polish (dock badges, About panel) → default menu + guards only.
4. E7 UI (BYOK field, PM-owned) → env-var key only.
5. Never cut: E2–E5, E8, E9-signing, E14-flags. An unsigned mic-dead app is not a deliverable.

## 4. Verification (end-to-end, on a real Mac)

```
1. pnpm install && pnpm --filter @mhacks/desktop check   # tsc strict green
2. pnpm --filter @mhacks/desktop test                     # existing suites green
3. pnpm --filter @mhacks/desktop dev                      # harness still works
4. pnpm --filter @mhacks/desktop dev:electron             # window opens, same loop
5. pnpm --filter @mhacks/desktop pack:dir                 # launchable .app
6. Look→speak→change→undo ×3 in the .app (AGENTS.md §8 bar)
7. Mic-denied + camera-denied full pass via click override
8. dist:mac → spctl -a → second-Mac install test
```

## 5. Definition of done (this branch)

- [ ] Harness untouched-green (steps 1–3 above) at every merge.
- [ ] Signed DMG installs on a clean Mac; loop in step 6 passes there.
- [ ] `.gitignore` covers `release/`; no secrets committed (`.env` already ignored ✅).
- [ ] `docs/grill-decisions.md` records the E10 option-A/B pick.
- [ ] `AGENTS.md §4` repo layout updated for `src/main`, `src/preload`, `src/guest` if the team keeps this structure.
