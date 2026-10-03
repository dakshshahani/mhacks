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
import { readFile } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FileGitService } from "@mhacks/shell";
import { PreviewHost } from "@mhacks/shell";
import { SpeechService } from "@mhacks/shell";
import { IpcRouter } from "@mhacks/shell";
import { DevServerManager } from "@mhacks/shell";
import { mockJev } from "@mhacks/contracts";
import {
  PipelineMachine,
  createJevLayer,
  generateNarrowDiff,
  verifyDecision,
} from "@mhacks/orchestrator";
import { decideAndEdit } from "./decide.ts";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");
const demoRoot = join(appRoot, "demo");
const port = Number(process.env.PORT ?? 5173);

const git = new FileGitService(demoRoot);
const preview = new PreviewHost();
// Canned probe — Dev A seam: replace setProbe arg with the WebGazer
// queryElementAt when it lands. Shape stays GazeFrame either way.
preview.setProbe(
  (x, y) =>
    Promise.resolve({
      candidates: [
        {
          id: "c0",
          selector: "div.hero",
          componentName: "Hero",
          filePath: "Hero.tsx",
          boundingRect: { x, y, width: 200, height: 120 },
          outerHTMLSnippet: '<div class="hero">Hello demo</div>',
          htmlTruncated: false,
          confidence: 0.9,
          trackedConfidence: 0.95,
          supportedOps: [{ op: "set-color", param: "brand" }],
        },
      ],
      lockedTarget: null,
      capturedAt: Date.now(),
    }),
  true,
);
const speech = new SpeechService([{ kind: "web-speech", isAvailable: () => true }]);
const pipeline = new PipelineMachine();

// HMR truth: watch the demo tree; executor flips hotReloaded only when the
// watcher actually observes the write (never optimistic).
const devServer = new DevServerManager();
await devServer.watch(demoRoot).catch((err) => {
  console.warn(`[harness] file watch unavailable, hotReloaded always false: ${String(err)}`);
});

/** Template-scoped build gate. The demo tree has no compiler; this checks
 *  what a bad edit observably breaks: empty files, unbalanced delimiters,
 *  dropped data-source mapping. Lenient by design — Tier-1 class/text edits
 *  always pass; a suspicious LLM diff fails safe into the fail card. */
function templateBuildGate() {
  return {
    check: async (filesChanged) => {
      for (const rel of filesChanged) {
        const text = await readFile(join(demoRoot, rel), "utf8").catch(() => null);
        if (text === null) return { ok: false, message: `gate: cannot read ${rel}` };
        if (text.trim().length === 0) return { ok: false, message: `gate: ${rel} is empty` };
        for (const [open, close] of [["{", "}"], ["(", ")"], ["[", "]"]]) {
          const opens = text.split(open).length;
          const closes = text.split(close).length;
          if (opens !== closes) {
            return { ok: false, message: `gate: ${rel} unbalanced ${open}${close}` };
          }
        }
        if (!text.includes("data-source=")) {
          return { ok: false, message: `gate: ${rel} lost data-source mapping` };
        }
      }
      return { ok: true };
    },
  };
}

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
    // small/large routes: Flash-Lite narrow diff. Null without a key (or on
    // outage) — the executor then falls back to the Tier-1 hint or fails
    // the envelope honestly; never a silent no-op.
    generateDiff: (req) => generateNarrowDiff(req),
    buildGate: templateBuildGate(),
    didReload: () => devServer.waitForReload(2000),
  },
});

const useMockJev = process.env.MOCK_JEV === "1";
const jevLayer = useMockJev ? mockJev : createJevLayer();

// speech:start doubles as the pipeline entry + Dev A lock-on signal.
speech.onState((s) => {
  if (s === "listening") pipeline.startListening();
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

function sendJson(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json" });
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
  const outcome = await decideAndEdit(transcript, x, y, {
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
  });
  switch (outcome.kind) {
    case "applied":
      sendJson(res, 200, {
        ok: true,
        decision: outcome.decision,
        editRequest: outcome.editRequest,
        editResult: outcome.editResult,
        undoWindowMs: outcome.undoWindowMs,
        verified: outcome.verified,
      });
      return;
    case "dropped":
      sendJson(res, 200, { ok: true, dropped: true, decision: outcome.decision });
      return;
    case "busy":
      sendJson(res, 409, { ok: false, code: "unknown", message: outcome.message });
      return;
    case "error":
      sendJson(res, 422, { ok: false, code: "build-failed", message: outcome.message });
      return;
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/api/events") {
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
  if (req.method === "POST" && url.pathname === "/api/transcript") {
    try {
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
      const { channel, req: payload } = await readJson(req);
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
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
    return;
  }
  try {
    const data = await readFile(join(appRoot, path));
    res.writeHead(200, { "Content-Type": MIME[extname(path)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});

server.listen(port, () => {
  console.log(`desktop harness on http://localhost:${port} (demo root: ${demoRoot})`);
  console.log(`[harness] jev: ${useMockJev ? "mockJev (MOCK_JEV=1)" : "live layer w/ mockJev fallback"}`);
});
