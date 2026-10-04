// Browser-harness server (G2-G3).
// REAL: HTTP, FileGitService, executor + Tier-1, PreviewHost, SpeechService,
// Dev B pipeline (Jev or mockJev -> composeEditRequest -> agent:submitEdit),
// Flash-Lite narrow diffs, template build gate, file-watch HMR truth.
// STUBBED at the boundary (injectable, Dev A seam): the gaze probe (canned
// single-candidate GazeFrame until the WebGazer client lands) and the
// recognizer (in-memory stub; the transcript box is the recognizer).
// MOCK_JEV=1 forces mockJev; otherwise createJevLayer() uses the live key
// and falls back to mockJev on timeout/outage. mockAgent is NOT used — the
// executor always applies for real so commitSha/undo stay truthful.

import { createServer } from "node:http";
import * as net from "node:net";
import { readFile, readdir, stat, mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join, extname, dirname, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { FileGitService } from "@mhacks/shell";
import { PreviewHost } from "@mhacks/shell";
import { SpeechService } from "@mhacks/shell";
import { IpcRouter } from "@mhacks/shell";
import { DevServerManager, pickFreePort, findComponentFiles, findMarkupFiles, findTextFiles, submitEdit as executorSubmitEdit } from "@mhacks/shell";
import { mockJev } from "@mhacks/contracts";
import {
  PipelineMachine,
  createJevLayer,
  generateNarrowDiff,
  verifyDecision,
  chooseFile,
} from "@mhacks/orchestrator";
import { decideAndEdit, extractTextSpans } from "./decide.ts";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");
const demoRoot = join(appRoot, "demo");
const port = Number(process.env.PORT ?? 5173);
// Harness origin (the proxy lives here, not on project ports). Named
// distinctly: openProject shadows `port` with the project's picked port.
const HARNESS_PORT = port;

const git = new FileGitService(demoRoot);
const preview = new PreviewHost();
// Harness stub probe — Dev A seam: replace with the WebGazer queryElementAt
// when it lands. Shape stays GazeFrame either way. Emulates a real prober:
// one candidate per template block element in DOM order (never shuffled),
// each with its data-source line, plus lockedTarget = deepest element under
// the point (mirrors elementsFromPoint hit-testing). Geometry is approximate
// stub data, good enough for click-to-override until the tracker supplies it.
preview.setProbe(
  (x, y) => {
    const candidates = [
      {
        id: "c0",
        selector: "div.hero",
        componentName: "Hero",
        filePath: "Hero.tsx",
        boundingRect: { x: 24, y: 24, width: 600, height: 200 },
        outerHTMLSnippet: '<div class="hero">…</div>',
        htmlTruncated: true,
        confidence: 0.9,
        trackedConfidence: 0.95,
        supportedOps: [{ op: "set-color", param: "brand" }],
        sourceLine: 1,
      },
      {
        id: "c1",
        selector: "h1",
        componentName: "HeroTitle",
        filePath: "Hero.tsx",
        boundingRect: { x: 40, y: 40, width: 300, height: 40 },
        outerHTMLSnippet: "<h1>Hello demo</h1>",
        htmlTruncated: false,
        confidence: 0.85,
        trackedConfidence: 0.9,
        supportedOps: [
          { op: "set-color", param: "brand" },
          { op: "swap-text", param: "Hello demo" },
        ],
        sourceLine: 2,
      },
      {
        id: "c2",
        selector: "p.sub",
        componentName: "HeroSub",
        filePath: "Hero.tsx",
        boundingRect: { x: 40, y: 90, width: 300, height: 24 },
        outerHTMLSnippet: "<p>Look at me, then speak.</p>",
        htmlTruncated: false,
        confidence: 0.85,
        trackedConfidence: 0.9,
        supportedOps: [
          { op: "set-color", param: "brand" },
          { op: "swap-text", param: "Look at me, then speak." },
        ],
        sourceLine: 3,
      },
      {
        id: "c3",
        selector: "button",
        componentName: "GoButton",
        filePath: "Hero.tsx",
        boundingRect: { x: 40, y: 124, width: 80, height: 36 },
        outerHTMLSnippet: "<button>Go</button>",
        htmlTruncated: false,
        confidence: 0.85,
        trackedConfidence: 0.9,
        supportedOps: [
          { op: "set-color", param: "brand" },
          { op: "set-radius", param: "full" },
          { op: "swap-text", param: "Go" },
        ],
        sourceLine: 4,
      },
    ];
    // Deepest containing candidate wins (DOM order = shallowest first).
    let lockedTarget = null;
    for (const c of candidates) {
      const r = c.boundingRect;
      if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) {
        lockedTarget = c;
      }
    }
    return Promise.resolve({
      candidates,
      lockedTarget,
      capturedAt: Date.now(),
    });
  },
  true,
);
const speech = new SpeechService([
  { kind: "web-speech", isAvailable: () => true },
  {
    kind: "scribe",
    isAvailable: () => (process.env.ELEVENLABS_API_KEY ?? "").length > 0,
  },
]);
const pipeline = new PipelineMachine();

// HMR truth: watch the demo tree; executor flips hotReloaded only when the
// watcher actually observes the write (never optimistic).
const devServer = new DevServerManager();
await devServer.watch(demoRoot).catch((err) => {
  console.warn(`[harness] file watch unavailable, hotReloaded always false: ${String(err)}`);
});

/** Build gate per root. The demo tree requires data-source markers (the
 *  template contract); foreign projects get the relaxed gate (grill-locked):
 *  non-empty, no diff-shaped output, balanced delimiters. Truncation and
 *  traversal are enforced separately in the executor. */
function buildGateFor(root, requireDataSource) {
  return {
    check: async (filesChanged) => {
      for (const rel of filesChanged) {
        const text = await readFile(join(root, rel), "utf8").catch(() => null);
        if (text === null) return { ok: false, message: `gate: cannot read ${rel}` };
        if (text.trim().length === 0) return { ok: false, message: `gate: ${rel} is empty` };
        if (/^```/m.test(text) || /^(@@|--- |\+\+\+ |diff --git )/m.test(text)) {
          return { ok: false, message: `gate: ${rel} looks like a diff, not file content` };
        }
        for (const [open, close] of [["{", "}"], ["(", ")"], ["[", "]"]]) {
          const opens = text.split(open).length;
          const closes = text.split(close).length;
          if (opens !== closes) {
            return { ok: false, message: `gate: ${rel} unbalanced ${open}${close}` };
          }
        }
        if (requireDataSource && !text.includes("data-source=")) {
          return { ok: false, message: `gate: ${rel} lost data-source mapping` };
        }
      }
      return { ok: true };
    },
  };
}

// Template scope for the Flash-Lite fallback (instruction-locked): filePath
// arrives via Dev A's data-source attr — no wide codebase search, the model
// works only within these files.
const demoFiles = await readdir(demoRoot)
  .then((fs) => fs.filter((f) => !f.startsWith(".")).join(", "))
  .catch(() => "Hero.tsx");
const projectContext =
  "React JSX template with Tailwind-style utilities; preview CSS defines only " +
  "bg-brand/bg-muted/bg-accent, rounded-sm/md/lg/full, p-2/4/8, gap-2/4/8, " +
  "text-left/center/right/justify. Use ONLY these token classes for styling; " +
  "never inline styles or new CSS (the preview cannot render style objects). " +
  `Template files: ${demoFiles}. Work only within these files.`;

const router = new IpcRouter({
  git,
  preview,
  speech,
  executorDeps: {
    readFile: (p) => readFile(p, "utf8"),
    writeFile: async (p, t) => {
      const { writeFile: wf } = await import("node:fs/promises");
      await wf(p, t, "utf8");
    },
    resolveRoot: (f) => (f ? join(demoRoot, f) : demoRoot),
    // §5.4b: address on the wire, content resolved here at apply time.
    readParentSection: async (address) => {
      if (!address.filePath) return null;
      const text = await readFile(join(demoRoot, address.filePath), "utf8").catch(() => null);
      return text === null ? null : text.slice(0, 2000);
    },
    // small/large routes: Flash-Lite full-file rewrite. Null without a key (or
    // on outage) — the executor then falls back to the Tier-1 hint or fails
    // the envelope honestly; never a silent no-op. attempt/lastError feed the
    // error-fed retry context the grill locked in.
    generateDiff: (req, ctx) =>
      generateNarrowDiff(req, {
        currentText: ctx.currentText,
        parentSection: ctx.parentSection,
        projectContext,
        lastError: ctx.lastError,
        attempt: ctx.attempt,
      }),
    buildGate: buildGateFor(demoRoot, true),
    didReload: () => devServer.waitForReload(2000),
  },
});

const useMockJev = process.env.MOCK_JEV === "1";
const jevLayer = useMockJev ? mockJev : createJevLayer();

// speech:start doubles as the pipeline entry + Dev A lock-on signal.
// Symmetrically, dropping to off while merely listening (mute/stop with no
// edit in flight) releases the pipeline back to idle — otherwise the next
// send would 409 against a stale listening stage. An in-flight decide
// re-enters listening itself after its probe, so this reset can't strand one.
speech.onState((s) => {
  if (s === "listening") pipeline.startListening();
  if (s === "off" && pipeline.getState().stage === "listening") pipeline.reset();
  broadcast({ type: "speech-state", state: s });
});
speech.onTranscript((event) => broadcast({ type: "speech-transcript", event }));
pipeline.subscribe((state) => broadcast({ type: "pipeline", state }));

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".tsx": "text/plain",
  ".json": "application/json",
};

// Token styles so Tier-1 ops are VISUALLY distinguishable in the preview.
// Mirrors the renderer maps in packages/shell/src/tier1.ts.
const TOKEN_CSS = [
  ".bg-brand{background:#2563eb;color:#fff}",
  ".bg-muted{background:#e5e7eb;color:#111}",
  ".bg-accent{background:#f59e0b;color:#111}",
  ".rounded-sm{border-radius:4px}.rounded-md{border-radius:8px}",
  ".rounded-lg{border-radius:16px}.rounded-full{border-radius:999px}",
  ".p-2{padding:8px}.p-4{padding:16px}.p-8{padding:32px}",
  ".gap-2{gap:8px}.gap-4{gap:16px}.gap-8{gap:32px}",
  ".text-left{text-align:left}.text-center{text-align:center}",
  ".text-right{text-align:right}.text-justify{text-align:justify}",
  ".text-2xl{font-size:1.5rem;font-weight:700}",
  ".hero{border:2px dashed #999;margin:8px}",
  ".hidden{display:none}",
].join("\n");

async function renderPreview() {
  const hero = await readFile(join(demoRoot, "Hero.tsx"), "utf8")
    .then((t) => t.replace(/className=/g, "class=")) // JSX -> HTML
    .catch(() => "<!-- Hero.tsx missing -->");
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>demo preview</title><style>${TOKEN_CSS}</style></head>
<body style="font-family: system-ui; padding: 24px;">
  ${hero}
  <script>
    document.addEventListener("click", (e) => {
      parent.postMessage({ type: "preview-click", x: e.clientX, y: e.clientY }, "*");
    });
  </script>
</body>
</html>`;
}

const sseClients = new Set();
function broadcast(event) {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(line);
    } catch {
      sseClients.delete(res);
    }
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(body.length > 0 ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

/** Raw byte reader with a cap (audio uploads). Rejects past maxBytes. */
function readBytes(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error(`audio too large (>${Math.round(maxBytes / 1024 / 1024)}MB)`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// ElevenLabs Scribe fallback (dev-c.md §5.6: Web Speech primary, Scribe
// fallback). The browser posts raw mic audio; the KEY never leaves the
// harness — the page only ever sees transcript text back. 100ms minimum
// audio per the API; utterances here are seconds long.
const SCRIBE_ENDPOINT = "https://api.elevenlabs.io/v1/speech-to-text";
const SCRIBE_MODEL = "scribe_v2";
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

async function transcribeWithScribe(audio, mimeType) {
  const apiKey = process.env.ELEVENLABS_API_KEY ?? "";
  if (apiKey.length === 0) {
    const err = new Error("no ElevenLabs key (speech fallback unavailable)");
    err.status = 200;
    err.code = "not-ready";
    throw err;
  }
  const form = new FormData();
  form.append("model_id", SCRIBE_MODEL);
  form.append(
    "file",
    new Blob([audio], { type: mimeType || "audio/webm" }),
    `utterance.${(mimeType || "").includes("wav") ? "wav" : "webm"}`,
  );
  const res = await fetch(SCRIBE_ENDPOINT, {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    const detail = await res.text().then((t) => t.slice(0, 300)).catch(() => "");
    throw new Error(`scribe ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  const body = await res.json();
  const text = typeof body.text === "string" ? body.text.trim() : "";
  return { text };
}

function sendJson(res, status, value) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(value));
}

async function handleDecideAndEdit(body, res) {
  const transcript = typeof body.transcript === "string" ? body.transcript : "";
  const x = Number(body.x);
  const y = Number(body.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    sendJson(res, 400, { ok: false, code: "unknown", message: "x/y must be numbers" });
    return;
  }
  // Transport-owned mutual exclusion (decide.ts only refuses mid-edit
  // stages). Checked and claimed synchronously — no await between, so two
  // racing sends can't both enter.
  const st = pipeline.getState().stage;
  if (
    decideActive > 0 ||
    st === "locked" ||
    st === "editing" ||
    st === "verifying"
  ) {
    sendJson(res, 409, {
      ok: false,
      code: "unknown",
      message: `pipeline is ${decideActive > 0 ? "busy" : st}; wait for applied/failed`,
    });
    return;
  }
  decideActive += 1;
  const t0 = Date.now();
  let outcome;
  try {
    // Edit context: demo stays on the canned probe + template gate; a named
    // project resolves its own context (own git, gate, resolveRoot) and
    // carries its frame in the request body (live probe posts it at click).
    const project =
      typeof body.project === "string" && body.project.length > 0 ? body.project : "demo";
    let services;
    if (project === "demo") {
      services = {
        decide: jevLayer,
        submitEdit: (req) => router.invoke("agent:submitEdit", req),
        verify: (t, diffSummary) => verifyDecision({ transcript: t, diffSummary }),
        pipeline,
        speech,
        queryFrame: async (qx, qy) => {
          const frame = await router.invoke("preview:queryElementAt", { x: qx, y: qy });
          if (!frame.ok) {
            const err = new Error(`preview: ${frame.message}`);
            err.code = frame.code === "not-ready" ? 503 : 502;
            throw err;
          }
          return frame.value;
        },
      };
    } else {
      let ctx = null;
      try {
        ctx = await projectContextFor(project);
      } catch {
        ctx = null;
      }
      if (!ctx) {
        sendJson(res, 422, {
          ok: false,
          code: "unknown",
          message: `unknown project "${project}": open it from the gallery first`,
        });
        return;
      }
      const frame = sanitizeFrame(body.frame);
      if (!frame || frame.candidates.length === 0) {
        const err = new Error("click the preview first so a target exists");
        err.code = 503;
        throw err;
      }
      console.log(`[edit] ${project}: ${frame.candidates.length} candidates, resolving target file…`);
      services = {
        decide: jevLayer,
        submitEdit: (req) => executorSubmitEdit(req, projectSubmitDeps(ctx)),
        verify: (t, diffSummary) => verifyDecision({ transcript: t, diffSummary }),
        pipeline,
        speech,
        queryFrame: () => Promise.resolve(frame),
        resolveFile: (target, transcript, intent) => resolveTargetFile(ctx, target, transcript, intent),
      };
    }
    outcome = await decideAndEdit(transcript, x, y, services);
  switch (outcome.kind) {
    case "applied": {
      const d = outcome.decision;
      console.log(
        `[pipeline] applied in ${Date.now() - t0}ms route=${d.route} intent=${d.intent} op=${d.op} param=${JSON.stringify(d.param)} verified=${outcome.verified} sha=${outcome.editResult.commitSha.slice(0, 8)}`,
      );
      sendJson(res, 200, {
        ok: true,
        decision: outcome.decision,
        editRequest: outcome.editRequest,
        editResult: outcome.editResult,
        undoWindowMs: outcome.undoWindowMs,
        verified: outcome.verified,
      });
      return;
    }
    case "dropped":
      sendJson(res, 200, { ok: true, dropped: true, decision: outcome.decision });
      return;
    case "busy":
      // Unreachable while the transport counter above holds (kept for the
      // direct-call shape): release the claim anyway via finally below.
      sendJson(res, 409, { ok: false, code: "unknown", message: outcome.message });
      return;
    case "error":
      console.log(`[pipeline] error after ${Date.now() - t0}ms: ${outcome.message}`);
      sendJson(res, 422, { ok: false, code: "build-failed", message: outcome.message });
      return;
  }
  } finally {
    decideActive -= 1;
  }
}

// In-flight decide count. Checked + claimed with no await between, so it is
// the atomic mutual-exclusion signal; pipeline stages alone can't serve
// because `listening` also means merely speech-armed.
let decideActive = 0;

// ---------------------------------------------------------------------------
// Project supervisor (gallery integration).
// The demo pipeline above stays pointed at demoRoot always: the canned probe,
// template build gate, executor resolveRoot and FileGitService are demo-only
// (gaze→edit on foreign repos is deferred — preview first). Foreign projects
// get process supervision + preview URL only, via this separate manager.
// Single-active: opening a project stops the previous one.
// ---------------------------------------------------------------------------

const PROJECTS_ROOT =
  process.env.PROJECTS_DIR ?? join(homedir(), "Documents", "Projects");

function frameworkOf(pkg) {
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  if ("next" in deps) return "Next.js";
  if ("vite" in deps || "astro" in deps) return "Vite";
  if ("react" in deps || "react-dom" in deps) return "React";
  if ("express" in deps || "fastify" in deps || "hono" in deps) return "Node";
  return "Node";
}

/** Live scan of PROJECTS_ROOT. Lists only runnable dirs: package.json with a
 *  non-empty `dev` script. Everything else is hidden, never greyed out. */
async function scanProjects() {
  const entries = await readdir(PROJECTS_ROOT, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith(".")) continue;
    const root = join(PROJECTS_ROOT, e.name);
    let pkg;
    try {
      pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    } catch {
      continue;
    }
    const dev = pkg?.scripts?.dev;
    if (typeof dev !== "string" || dev.trim().length === 0) continue;
    let mtimeMs = 0;
    try {
      mtimeMs = (await stat(root)).mtimeMs;
    } catch {
      // Leave 0 — purely display data, never blocks listing.
    }
    out.push({ name: e.name, path: root, framework: frameworkOf(pkg), mtimeMs });
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}

/** Resolve a gallery name to its project root. Throws on anything that is
 *  not a directly-scanned runnable child (traversal + scope guard). */
async function resolveProjectRoot(name) {
  if (typeof name !== "string" || name.length === 0 || name.length > 120) {
    throw new Error("unknown project");
  }
  if (name.includes("/") || name.includes("\\") || name === "." || name === "..") {
    throw new Error("unknown project");
  }
  const root = normalize(join(PROJECTS_ROOT, name));
  if (root !== join(PROJECTS_ROOT, name) || !root.startsWith(PROJECTS_ROOT + sep)) {
    throw new Error("unknown project");
  }
  const st = await stat(root).catch(() => null);
  if (!st || !st.isDirectory()) throw new Error("unknown project");
  // Re-validate the runnable filter at open time — the scan is display data,
  // this is the execution gate.
  let pkg;
  try {
    pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  } catch {
    throw new Error(`"${name}" has no readable package.json`);
  }
  const dev = pkg?.scripts?.dev;
  if (typeof dev !== "string" || dev.trim().length === 0) {
    throw new Error(`"${name}" has no dev script to run`);
  }
  return root;
}

const projectServer = new DevServerManager();
let activeProject = null; // { name, root, previewUrl, port, startedAt }
let openingProject = null; // in-flight open name (transport-owned mutual exclusion)

function runInstall(root) {
  return new Promise((resolve) => {
    execFile("pnpm", ["install", "--prefer-offline"], { cwd: root, timeout: 240000 }, (err, stdout, stderr) => {
      const tail = `${stdout ?? ""}\n${stderr ?? ""}`.slice(-3000);
      if (err) resolve({ ok: false, log: tail });
      else resolve({ ok: true, log: tail });
    });
  });
}

function shExec(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, (err, stdout) => resolve(err ? "" : String(stdout ?? "")));
  });
}

/** Supervision marker: which port OUR harness claimed for this root. Lets a
 *  later open (possibly a new harness process after a restart) distinguish
 *  our orphaned servers from the user's own, and reap only ours. */
async function writeSupervisorMarker(root, port) {
  try {
    await mkdir(join(root, ".mhacks-snapshots"), { recursive: true });
    await writeFile(
      join(root, ".mhacks-snapshots", "supervisor.json"),
      JSON.stringify({ port, by: "mhacks-harness", at: Date.now() }),
    );
  } catch {
    // Best-effort bookkeeping — never blocks supervision.
  }
}

/** Kill only OUR stale servers for this root: processes listening on the
 *  recorded port whose cwd is the root and whose command looks dev-shaped.
 *  Anything else (the user's own servers) is left alone — Next's lock
 *  detection remains the backstop and surfaces an honest conflict error. */
async function reapStaleSupervised(root) {
  let rec = null;
  try {
    rec = JSON.parse(await readFile(join(root, ".mhacks-snapshots", "supervisor.json"), "utf8"));
  } catch {
    return;
  }
  if (!rec || typeof rec.port !== "number" || rec.by !== "mhacks-harness") return;
  const out = await shExec("lsof", ["-ti", `:${rec.port}`, "-sTCP:LISTEN"]);
  const pids = out.split(/\s+/).map(Number).filter((n) => n > 0);
  for (const pid of pids) {
    try {
      const cwdOut = await shExec("lsof", ["-p", String(pid), "-a", "-d", "cwd"]);
      const cmdOut = await shExec("ps", ["-o", "command=", "-p", String(pid)]);
      const ours =
        cwdOut.includes(root) && /(next|vite|dev|turbo|astro)/.test(cmdOut) && !/dev-server\.mjs/.test(cmdOut);
      if (!ours) continue;
      console.log(`[projects] reaping stale supervised server pid ${pid} (port ${rec.port})`);
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Already gone.
      }
    } catch {
      // Best-effort per pid.
    }
  }
}

const URL_RE = /https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/[^\s"'`]*)?/;

/** Wait for the child to print a localhost URL (or readiness keywords),
 *  then resolve the preview URL. Falls back to the pinned port. */
async function waitForPreviewUrl(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const lines = projectServer.logLines;
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = URL_RE.exec(lines[i] ?? "");
      if (m) return m[0].replace(/\/$/, "");
    }
    if (!projectServer.running) {
      const tail = lines.slice(-20).join("\n").slice(-2000);
      throw new Error(`dev server exited before becoming ready${tail ? `: ${tail}` : ""}`);
    }
    if (Date.now() >= deadline) return `http://localhost:${port}`;
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** Definitive liveness: any HTTP status (even 307/404) proves the process
 *  serves. Log-sniffing alone lies — a dying server prints its address before
 *  failing (Next's already-running conflict), and the liveness race between
 *  "URL seen" and "process exited" publishes dead servers as live. */
async function waitForHttpOk(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = "no attempt";
  for (;;) {
    try {
      const res = await fetch(url, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
      });
      await res.arrayBuffer().catch(() => null); // drain
      return;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    if (Date.now() >= deadline) throw new Error(`never became reachable: ${lastErr}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function openProject(name) {
  console.log(`[projects] open "${name}" requested (pid ${process.pid}, active=${activeProject?.name ?? "none"})`);
  if (openingProject !== null) {
    throw Object.assign(new Error(`already opening "${openingProject}"`), { status: 409 });
  }
  const root = await resolveProjectRoot(name);
  if (activeProject && activeProject.name === name && projectServer.running) {
    return activeProject;
  }
  openingProject = name;
  try {
    await reapStaleSupervised(root);
    await projectServer.stop();
    activeProject = null;
    // Deps may be missing (fresh clone / never installed). Allowed to touch
    // the real folder per integration spec — install in place.
    if (!(await stat(join(root, "node_modules")).catch(() => null))) {
      console.log(`[projects] installing deps for "${name}"…`);
      const res = await runInstall(root);
      if (!res.ok) throw new Error(`pnpm install failed for "${name}": ${res.log.slice(-500)}`);
    }
    const port = await pickFreePort();
    projectServer.clearLogs();
    await projectServer.start({
      root,
      command: "pnpm",
      // pnpm forwards trailing flags to the dev script; PORT covers CLIs
      // (next) that honor the env convention instead.
      args: ["dev", "--port", String(port)],
      env: { PORT: String(port) },
      port,
    });
    // Readiness waits on the DIRECT url; the workspace iframes the PROXY url
    // (same harness origin serves the probe script injection point).
    const directUrl = await waitForPreviewUrl(port);
    // The readiness URL can come from a dying server's own logs (it prints
    // its address before failing, e.g. Next's already-running conflict) —
    // require a real HTTP response before publishing, or fail honestly.
    // A named conflicting PID (our orphan or the user's own server) is
    // surfaced so the gallery error tells them exactly what to stop.
    try {
      await waitForHttpOk(directUrl, 30000);
    } catch (err) {
      const tail = projectServer.logLines.slice(-12).join("\n").slice(-800);
      const pidMatch = /- PID:\s*(\d+)/.exec(tail);
      throw new Error(
        `dev server for "${name}" ${err instanceof Error ? err.message : String(err)}` +
          (pidMatch
            ? `; another dev server holds it (pid ${pidMatch[1]}): stop that server, then reopen`
            : tail ? `: ${tail}` : ""),
      );
    }
    if (!projectServer.running) {
      const tail = projectServer.logLines.slice(-12).join("\n").slice(-800);
      throw new Error(`dev server for "${name}" exited during start${tail ? `: ${tail}` : ""}`);
    }
    await writeSupervisorMarker(root, port);
    const ctx = await projectContextFor(name);
    activeProject = {
      name,
      root,
      directUrl,
      previewUrl: `http://localhost:${HARNESS_PORT}/proxy/${encodeURIComponent(name)}/`,
      port,
      startedAt: Date.now(),
    };
    console.log(`[projects] "${name}" on ${activeProject.previewUrl} (direct ${directUrl})`);
    return activeProject;
  } finally {
    openingProject = null;
  }
}

// ---------------------------------------------------------------------------
// Per-project edit contexts (every project editable like demo).
// The demo pipeline stays demoRoot-scoped (canned probe, template gate);
// foreign projects get their own git service, relaxed gate, resolveRoot and
// projectContext. Contexts persist across supervision switches (cheap git
// handles); only ONE dev server runs at a time (single-active).
// ---------------------------------------------------------------------------

const projectContexts = new Map();

async function projectContextFor(name) {
  let ctx = projectContexts.get(name);
  if (ctx) return ctx;
  const root = await resolveProjectRoot(name);
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const framework = frameworkOf(pkg);
  let topLevel = "";
  try {
    topLevel = (await readdir(root))
      .filter((f) => !f.startsWith(".") && f !== "node_modules")
      .join(", ");
  } catch {
    // Display data only — never blocks editing.
  }
  ctx = {
    name,
    root,
    framework,
    git: new FileGitService(root),
    projectContext:
      `${framework} project. Top-level: ${topLevel.slice(0, 1500)}. ` +
      "Work only within these files; reuse styling already present plus the " +
      "catalog tokens (bg-brand/bg-muted/bg-accent, rounded-*, p-*/gap-*, " +
      "text-left/center/right/justify). Never inline styles.",
    buildGate: buildGateFor(root, false),
  };
  projectContexts.set(name, ctx);
  return ctx;
}

/** Executor deps bound to a project context (mirrors the demo router deps,
 *  but rooted at the project with its gate + model context). */
function projectSubmitDeps(ctx) {
  return {
    git: ctx.git,
    readFile: (p) => readFile(p, "utf8"),
    writeFile: async (p, t) => {
      const { writeFile: wf } = await import("node:fs/promises");
      await wf(p, t, "utf8");
    },
    resolveRoot: (f) => (f ? join(ctx.root, f) : ctx.root),
    readParentSection: async (address) => {
      if (!address.filePath) return null;
      const text = await readFile(join(ctx.root, address.filePath), "utf8").catch(() => null);
      return text === null ? null : text.slice(0, 2000);
    },
    generateDiff: (req, gctx) =>
      generateNarrowDiff(req, {
        currentText: gctx.currentText,
        parentSection: gctx.parentSection,
        projectContext: ctx.projectContext,
        lastError: gctx.lastError,
        attempt: gctx.attempt,
      }),
    buildGate: ctx.buildGate,
    // HMR truth only when this project is the supervised one; otherwise
    // honest false (the edit + gate + undo are still real).
    didReload: () =>
      activeProject && activeProject.name === ctx.name
        ? projectServer.waitForReload(2000)
        : Promise.resolve(false),
  };
}

function cleanComponentName(n) {
  return typeof n === "string" && /^[A-Za-z0-9_$. -]{1,60}$/.test(n) ? n : null;
}

function clamp01json(n, fallback) {
  return typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
}

/** Validate a client-posted frame (probe.js output is page-adjacent input,
 *  not trusted data). filePath is ALWAYS re-nulled: only the hybrid finder
 *  below may set it, from server-side search. */
function sanitizeFrame(raw) {
  if (!raw || !Array.isArray(raw.candidates)) return null;
  const cleanStr = (s, n) => (typeof s === "string" ? s.slice(0, n) : null);
  const cleanRect = (r) => ({
    x: Math.round(Number(r?.x) || 0),
    y: Math.round(Number(r?.y) || 0),
    width: Math.max(0, Math.round(Number(r?.width) || 0)),
    height: Math.max(0, Math.round(Number(r?.height) || 0)),
  });
  const cleanOne = (c, i) => ({
    id: typeof c.id === "string" && c.id.length > 0 ? c.id.slice(0, 40) : `c${i}`,
    selector: cleanStr(c.selector, 200) ?? "",
    // Names flow into the Jev state text: strict charset so page content
    // can't smuggle prompt-influencing tokens into an action-mapped field.
    componentName: cleanComponentName(c.componentName),
    filePath: null,
    boundingRect: cleanRect(c.boundingRect),
    outerHTMLSnippet: cleanStr(c.outerHTMLSnippet, 2048) ?? "",
    htmlTruncated: c.htmlTruncated === true,
    confidence: clamp01json(c.confidence, 0.5),
    trackedConfidence: clamp01json(c.trackedConfidence, 0.5),
    supportedOps: Array.isArray(c.supportedOps)
      ? c.supportedOps
          .filter((o) => o && typeof o.op === "string")
          .slice(0, 6)
          .map((o) => ({ op: o.op.slice(0, 20), param: typeof o.param === "string" ? o.param.slice(0, 200) : null }))
      : [],
    // Click surroundings for instance disambiguation (non-contract field:
    // carried opaquely through the typed layers, consumed only here).
    contextHTML: typeof c.contextHTML === "string" ? c.contextHTML.slice(0, 1200) : null,
    screenshotCrop: null,
    sourceLine: null,
  });
  const candidates = raw.candidates.slice(0, 5).map(cleanOne);
  // Re-key ids positionally (c0..) — the join key only needs stability
  // inside THIS frame, and client ids are arbitrary strings.
  candidates.forEach((c, i) => {
    c.id = `c${i}`;
  });
  // lockedTarget is re-derived server-side (decide.ts lock-on emulation:
  // deepest element under the point). The client's claim is dropped with the
  // rest of the untrusted frame — only sanitized candidates cross.
  return { candidates, lockedTarget: null, capturedAt: Date.now() };
}

/** Hybrid file resolution (grill-locked): text-anchored for content intents
 *  (the quoted span names the text; its file is the USAGE file, which matters
 *  more than where the component is defined), component-anchored otherwise
 *  (convention search, then rendered-markup evidence), LLM tie-break only
 *  when multiple evidence-backed files match. Returns a root-relative path or
 *  null (fail card). */
async function resolveTargetFile(ctx, target, transcript, intent) {
  const contextHTML =
    typeof target.contextHTML === "string" && target.contextHTML.length > 0
      ? target.contextHTML
      : undefined;
  const pickFrom = async (candidates, label) => {
    if (candidates.length === 1) return candidates[0];
    if (candidates.length === 0) return null;
    try {
      return await chooseFile({
        transcript,
        componentName: cleanComponentName(target.componentName) ?? "element",
        outerHTMLSnippet: target.outerHTMLSnippet ?? "",
        ...(contextHTML !== undefined ? { contextHTML } : {}),
        candidates: candidates.slice(0, 12),
      });
    } catch {
      return null;
    }
  };
  // 1. Text-anchored: content edits quote their text ("change X to Y").
  if (intent === "content") {
    for (const span of extractTextSpans(transcript).slice(0, 3)) {
      let hits = [];
      try {
        hits = await findTextFiles(ctx.root, span);
      } catch {
        hits = [];
      }
      if (hits.length > 0) {
        console.log(`[edit] ${ctx.name}: text-anchored "${span.slice(0, 40)}" -> ${hits.length} file(s)`);
        const picked = await pickFrom(hits, span);
        if (picked) return picked;
      }
    }
  }
  // 2. Component-anchored: where is this component defined.
  const name = cleanComponentName(target.componentName);
  if (name) {
    let matches = [];
    try {
      matches = await findComponentFiles(ctx.root, name);
    } catch {
      matches = [];
    }
    if (matches.length > 0) {
      console.log(`[edit] ${ctx.name}: component-anchored "${name}" -> ${matches.length} file(s)`);
      const picked = await pickFrom(
        matches.map((m) => m.path),
        name,
      );
      if (picked) return picked;
    }
  }

  // 3. Rendered-markup fallback. A clicked host element can sit inside an
  // inline/anonymous component, or behind a forwardRef wrapper, so the fiber
  // name above may not exist as a source definition. Class tokens and visible
  // text survive rendering and provide stronger evidence for the file that
  // contains this instance. Multiple matches still go through the same
  // allowlisted model tie-break; no file is guessed when evidence is absent.
  const targetMarkup = target.outerHTMLSnippet ?? "";
  const markup = [targetMarkup, contextHTML ?? ""].join("\n");
  const markers = [];
  for (const match of markup.matchAll(/\bclass(?:Name)?=["']([^"']+)["']/g)) {
    for (const token of match[1].split(/\s+/)) {
      if (token.length >= 3) markers.push(token);
    }
  }
  const visibleText = targetMarkup
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (visibleText.length >= 2 && visibleText.length <= 120) markers.push(visibleText);
  if (markers.length > 0) {
    let matches = [];
    try {
      matches = await findMarkupFiles(ctx.root, markers);
    } catch {
      matches = [];
    }
    if (matches.length > 0) {
      console.log(`[edit] ${ctx.name}: rendered-markup evidence -> ${matches.length} file(s)`);
      const picked = await pickFrom(matches, "rendered markup");
      if (picked) return picked;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reverse proxy: foreign dev servers render; the harness supervises.
// /proxy/:name/* forwards to the supervised project server, injecting the
// probe script into HTML and stripping frame-busting headers so the workspace
// iframe can embed it. Unknown non-own paths fall through to the active
// project too (absolute /_next/* asset URLs keep working). HMR websockets
// upgrade straight through (see server.on("upgrade") below).
// ---------------------------------------------------------------------------

const PROBE_TAG = '<script src="/src/probe.js"></script>';

function injectProbe(html) {
  if (html.includes("/src/probe.js")) return html;
  const i = html.toLowerCase().lastIndexOf("</body>");
  if (i >= 0) return html.slice(0, i) + PROBE_TAG + html.slice(i);
  return html + PROBE_TAG;
}

function rewriteProxiedLocation(loc, targetUrl, projectName) {
  try {
    const u = new URL(loc, targetUrl);
    if (
      (u.hostname === "127.0.0.1" || u.hostname === "localhost") &&
      Number(u.port) === activeProject.port
    ) {
      return `/proxy/${encodeURIComponent(projectName)}${u.pathname}${u.search}`;
    }
  } catch {
    // Not parseable — pass through untouched.
  }
  return loc;
}

async function proxyToActive(req, res, upstreamPath) {
  if (!activeProject || !projectServer.running) {
    sendJson(res, 502, {
      ok: false,
      code: "not-ready",
      message: "no project server running — open one from the gallery",
    });
    return;
  }
  const targetUrl = `http://127.0.0.1:${activeProject.port}${upstreamPath}`;
  let bodyBuf = null;
  if (req.method !== "GET" && req.method !== "HEAD") {
    try {
      bodyBuf = await readBytes(req, MAX_AUDIO_BYTES);
    } catch (err) {
      sendJson(res, 502, { ok: false, code: "unknown", message: String(err) });
      return;
    }
  }
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    const lk = k.toLowerCase();
    if (["connection", "keep-alive", "transfer-encoding", "upgrade", "host", "content-length"].includes(lk)) {
      continue;
    }
    headers[k] = v;
  }
  let upstream;
  try {
    upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: bodyBuf,
      redirect: "manual",
    });
  } catch (err) {
    sendJson(res, 502, {
      ok: false,
      code: "unknown",
      message: `project server unreachable: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }
  const outHeaders = {};
  upstream.headers.forEach((v, k) => {
    const lk = k.toLowerCase();
    if (lk === "x-frame-options") return;
    if (lk === "content-security-policy") {
      const stripped = v.replace(/frame-ancestors[^;]*;?/gi, "").trim();
      if (stripped) outHeaders[k] = stripped;
      return;
    }
    // Framing/length headers are re-derived below (undici may have decoded
    // the body, which would invalidate upstream lengths).
    if (["content-encoding", "transfer-encoding", "connection", "content-length"].includes(lk)) return;
    outHeaders[k] = v;
  });
  if (upstream.status >= 300 && upstream.status < 400) {
    const loc = upstream.headers.get("location");
    if (loc) outHeaders["location"] = rewriteProxiedLocation(loc, targetUrl, activeProject.name);
  }
  const ctype = upstream.headers.get("content-type") ?? "";
  if (ctype.includes("text/html")) {
    let html = "";
    try {
      html = await upstream.text();
    } catch {
      sendJson(res, 502, { ok: false, code: "unknown", message: "project server hung up mid-page" });
      return;
    }
    const buf = Buffer.from(injectProbe(html), "utf8");
    outHeaders["content-length"] = String(buf.length);
    res.writeHead(upstream.status, outHeaders);
    res.end(buf);
    return;
  }
  res.writeHead(upstream.status, outHeaders);
  if (upstream.body) {
    try {
      for await (const chunk of upstream.body) {
        if (!res.write(chunk)) await new Promise((r) => res.once("drain", r));
      }
    } catch {
      // Client went away mid-stream.
    }
  }
  res.end();
}

/** Project-scoped invoke. Returns null when the channel is global (caller
 *  falls through to the demo router). Envelopes mirror ipcRouter shapes. */
async function invokeForProject(project, channel, payload) {
  if (
    channel !== "git:createSnapshot" &&
    channel !== "git:undo" &&
    channel !== "git:confirm" &&
    channel !== "git:history" &&
    channel !== "agent:submitEdit" &&
    channel !== "preview:queryElementAt"
  ) {
    return null;
  }
  let ctx = null;
  try {
    ctx = await projectContextFor(project);
  } catch {
    ctx = null;
  }
  if (!ctx) {
    return { ok: false, code: "unknown", message: `unknown project "${project}": open it from the gallery first` };
  }
  try {
    switch (channel) {
      case "git:createSnapshot": {
        const snap = await ctx.git.createSnapshot(payload?.label ?? "snapshot");
        return { ok: true, value: { sha: snap.sha } };
      }
      case "git:undo": {
        const { snap } = await ctx.git.undo();
        return { ok: true, value: { sha: snap.sha } };
      }
      case "git:confirm": {
        const found = await ctx.git.confirm(payload?.sha);
        return { ok: true, value: { sha: found.sha } };
      }
      case "git:history": {
        const list = await ctx.git.history();
        return { ok: true, value: list.map((s) => ({ sha: s.sha, label: s.label, at: s.at })) };
      }
      case "agent:submitEdit":
        return await executorSubmitEdit(payload, projectSubmitDeps(ctx));
      case "preview:queryElementAt":
        // Foreign probes post frames directly at click time (preview-frame
        // messages); there is no server-side prober to query.
        return {
          ok: false,
          code: "not-ready",
          message: "live probe posts frames directly; click the preview first",
        };
      default:
        return null;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (channel === "git:undo" && message.includes("nothing to undo")) {
      return { ok: false, code: "not-ready", message };
    }
    return { ok: false, code: "unknown", message };
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/projects") {
    try {
      sendJson(res, 200, { ok: true, value: await scanProjects() });
    } catch (err) {
      sendJson(res, 200, {
        ok: false,
        code: "unknown",
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/projects/active") {
    sendJson(res, 200, {
      ok: true,
      value:
        activeProject && projectServer.running
          ? { ...activeProject, running: true, supervisorPid: process.pid }
          : null,
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/projects/logs") {
    const tail = Math.min(Math.max(Number(url.searchParams.get("tail")) || 200, 1), 500);
    sendJson(res, 200, {
      ok: true,
      value: {
        name: activeProject?.name ?? null,
        running: projectServer.running,
        lines: projectServer.logLines.slice(-tail),
      },
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/projects/open") {
    try {
      const body = await readJson(req);
      const opened = await openProject(body.name);
      sendJson(res, 200, { ok: true, value: opened });
    } catch (err) {
      const status = err && typeof err.status === "number" ? err.status : 200;
      sendJson(res, status, {
        ok: false,
        code: "unknown",
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/events") {
    // Reconcile before replaying: `processing` is only legal alongside a
    // live decide (counter > 0 or a mid-edit stage). Anything else is an
    // orphaned utterance (failed send, reload mid-flow) — release it so a
    // fresh subscribe never restores a stuck chip.
    if (
      speech.currentState === "processing" &&
      decideActive === 0 &&
      !["locked", "editing", "verifying"].includes(pipeline.getState().stage)
    ) {
      speech.resetToIdle();
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    sseClients.add(res);
    res.write(`data: ${JSON.stringify({ type: "pipeline", state: pipeline.getState() })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: "speech-state", state: speech.currentState })}\n\n`);
    req.on("close", () => {
      sseClients.delete(res);
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/decide-and-edit") {
    try {
      const body = await readJson(req);
      await handleDecideAndEdit(body, res);
    } catch (err) {
      const status = err && typeof err.code === "number" ? err.code : 500;
      sendJson(res, status, {
        ok: false,
        code: status === 503 ? "not-ready" : "unknown",
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/transcribe") {
    try {
      const mimeType = req.headers["content-type"] ?? "audio/webm";
      if (!mimeType.startsWith("audio/")) {
        sendJson(res, 200, { ok: false, code: "unknown", message: "expected an audio/* body" });
        return;
      }
      const audio = await readBytes(req, MAX_AUDIO_BYTES);
      if (audio.length === 0) {
        sendJson(res, 200, { ok: false, code: "unknown", message: "empty audio" });
        return;
      }
      const t0 = Date.now();
      try {
        const { text } = await transcribeWithScribe(audio, mimeType);
        console.log(`[stt] ${audio.length} bytes ${mimeType} -> ${JSON.stringify(text.slice(0, 80))} (${Date.now() - t0}ms)`);
        sendJson(res, 200, { ok: true, value: { text } });
      } catch (err) {
        console.log(`[stt] scribe failed after ${Date.now() - t0}ms: ${err instanceof Error ? err.message : String(err)}`);
        throw err;
      }
    } catch (err) {
      sendJson(res, 200, {
        ok: false,
        code: err && typeof err.code === "string" ? err.code : "unknown",
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/transcript") {    try {
      const body = await readJson(req);
      const text = typeof body.text === "string" ? body.text : "";
      speech.pushTranscript(text, body.isFinal !== false);
      sendJson(res, 200, { ok: true, value: { state: speech.currentState } });
    } catch (err) {
      sendJson(res, 400, { ok: false, code: "unknown", message: String(err) });
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/invoke") {
    try {
      const { channel, req: payload, project } = await readJson(req);
      // Foreign edit contexts: git:* runs against the project's own snapshot
      // store (demo router stays demoRoot-scoped). agent:submitEdit goes
      // through the project deps too. speech:*/preview:* are global services.
      if (typeof project === "string" && project.length > 0 && project !== "demo") {
        const out = await invokeForProject(project, channel, payload);
        if (out !== null) {
          sendJson(res, 200, out);
          return;
        }
      }
      const out = await router.invoke(channel, payload);
      sendJson(res, 200, out);
    } catch (err) {
      sendJson(res, 200, { ok: false, code: "unknown", message: String(err) });
    }
    return;
  }
  const path = url.pathname === "/" ? "/index.html" : url.pathname;
  // Live preview: rendered from the CURRENT Hero.tsx on every load, so
  // executor edits are visible in the iframe after reload.
  if (path === "/demo/preview.html") {
    const html = await renderPreview();
    res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
    res.end(html);
    return;
  }
  // Proxied project pages (/proxy/:name/*). Everything else unknown falls
  // through to the active project too, so absolute /_next/* asset URLs and
  // client-side routes keep working under the harness origin.
  if (url.pathname.startsWith("/proxy/")) {
    const seg = url.pathname.slice("/proxy/".length).split("/");
    const name = decodeURIComponent(seg[0] ?? "");
    if (!activeProject || activeProject.name !== name) {
      sendJson(res, 404, {
        ok: false,
        code: "not-ready",
        message: `no supervised server for "${name || "?"}": open it from the gallery`,
      });
      return;
    }
    await proxyToActive(req, res, `/${seg.slice(1).join("/")}${url.search}`);
    return;
  }
  try {
    const data = await readFile(join(appRoot, path));
    res.writeHead(200, {
      "Content-Type": MIME[extname(path)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  } catch {
    // Own-file miss: try the active project (absolute asset/route URLs).
    if (activeProject && projectServer.running) {
      await proxyToActive(req, res, `${url.pathname}${url.search}`);
      return;
    }
    res.writeHead(404);
    res.end("not found");
  }
});

// HMR websocket passthrough (Next + Vite dev clients open an upgrade to the
// page origin — here, the harness). Transparent TCP pipe to the supervised
// project server; own paths and unsupervised states get a clean destroy.
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  // Dev clients (Vite/Next HMR) upgrade raw absolute paths (/@vite/client,
  // /_next/webpack-hmr) against the page origin — the harness. Only /api/*
  // belongs to us; everything else pipes to the supervised project server.
  if (url.pathname.startsWith("/api/")) {
    socket.destroy();
    return;
  }
  if (!activeProject || !projectServer.running) {
    socket.destroy();
    return;
  }
  const target = net.connect(activeProject.port, "127.0.0.1", () => {
    let raw = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
    for (const [k, v] of Object.entries(req.headers)) {
      raw += `${k}: ${Array.isArray(v) ? v.join(", ") : v}\r\n`;
    }
    target.write(`${raw}\r\n`);
    if (head && head.length) target.write(head);
    socket.pipe(target);
    target.pipe(socket);
  });
  target.on("error", () => {
    try {
      socket.destroy();
    } catch {
      // Already gone.
    }
  });
  socket.on("error", () => {
    try {
      target.destroy();
    } catch {
      // Already gone.
    }
  });
});

server.listen(port, () => {
  console.log(`desktop harness on http://localhost:${port} (demo root: ${demoRoot})`);
  console.log(`[harness] jev: ${useMockJev ? "mockJev (MOCK_JEV=1)" : "live layer w/ mockJev fallback"}`);
});
