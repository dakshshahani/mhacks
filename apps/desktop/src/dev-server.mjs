// Thin static server for the browser harness (G1-G2).
// REAL: HTTP, FileGitService, executor, Tier-1, PreviewHost, SpeechService,
// all running in Node against apps/desktop/demo.
// STUBBED (boundary, injectable): gaze probe (canned GazeFrame), recognizers
// (in-memory), diff generator (Tier-1 only), build gate (pass-through).
// Dev B's orchestrator (real Jev + Flash-Lite, or mockJev/mockAgent) talks to
// the same IpcRouter via POST /api/invoke — swap the canned frame for
// Decision -> composeEditRequest output at G2/G3 with no shell changes.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FileGitService } from "../../../packages/shell/src/git.ts";
import { PreviewHost } from "../../../packages/shell/src/preview.ts";
import { SpeechService } from "../../../packages/shell/src/speech.ts";
import { IpcRouter } from "../../../packages/shell/src/ipcRouter.ts";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");
const demoRoot = join(appRoot, "demo");
const port = Number(process.env.PORT ?? 5173);

const git = new FileGitService(demoRoot);
const preview = new PreviewHost();
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
  },
});

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

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "POST" && url.pathname === "/api/invoke") {
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const { channel, req: payload } = JSON.parse(body);
      const out = await router.invoke(channel, payload);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out));
    } catch (err) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, code: "unknown", message: String(err) }));
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
});
