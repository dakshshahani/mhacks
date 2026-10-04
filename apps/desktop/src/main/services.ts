// Demo-scoped service construction (phase 2: the harness pipeline, moved
// into main). Foreign-project supervision/proxy stays in dev-server.mjs
// (harness-only; template-only packaged shell per E10-A).
//
// No decision logic here: this only wires Dev B's orchestrator to Dev C's
// shell services. Events leave through the injected emit() (bridge sends
// them to the renderer); the harness SSE equivalent is dead code after this.

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  DevServerManager,
  GitService,
  IpcRouter,
  PreviewHost,
  SpeechService,
} from "@mhacks/shell";
import { mockJev } from "@mhacks/contracts";
import type {
  DecisionLayer,
  EditRequest,
  GazeFrame,
  IpcResult,
  PipelineState,
  SpeechEvent,
  SpeechState,
} from "@mhacks/contracts";
import {
  PipelineMachine,
  createJevLayer,
  generateNarrowDiff,
  verifyDecision,
} from "@mhacks/orchestrator";

export type ShellEvent =
  | { type: "pipeline"; state: PipelineState }
  | { type: "speech-state"; state: SpeechState }
  | { type: "speech-transcript"; event: SpeechEvent };

export interface DemoServices {
  router: IpcRouter;
  preview: PreviewHost;
  speech: SpeechService;
  pipeline: PipelineMachine;
  decide: DecisionLayer;
  devServer: DevServerManager;
  demoRoot: string;
  demoFileSet: Set<string>;
  projectContext: string;
  queryFrame: (x: number, y: number) => Promise<GazeFrame>;
  submitEdit: (req: EditRequest) => Promise<IpcResult<import("@mhacks/contracts").EditResult>>;
  verify: (transcript: string, diffSummary: string) => Promise<{ matches: number }>;
  sanitizeFrame: (raw: unknown) => {
    candidates: GazeFrame["candidates"];
    lockedTarget: null;
    capturedAt: number;
  } | null;
}

/** Template build gate (grill-locked): demo files must keep data-source
 *  markers; non-empty; no diff-shaped output; balanced delimiters. */
function buildGateFor(root: string) {
  const PAIRS: [string, string][] = [["{", "}"], ["(", ")"], ["[", "]"]];
  return {
    check: async (
      filesChanged: string[],
    ): Promise<{ ok: true } | { ok: false; message: string }> => {
      for (const rel of filesChanged) {
        const text = await readFile(join(root, rel), "utf8").catch(() => null);
        if (text === null) return { ok: false, message: `gate: cannot read ${rel}` };
        if (text.trim().length === 0) return { ok: false, message: `gate: ${rel} is empty` };
        if (/^```/m.test(text) || /^(@@|--- |\+\+\+ |diff --git )/m.test(text)) {
          return { ok: false, message: `gate: ${rel} looks like a diff, not file content` };
        }
        for (const [open, close] of PAIRS) {
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

function cleanComponentName(n: unknown): string | null {
  return typeof n === "string" && /^[A-Za-z0-9_$. -]{1,60}$/.test(n) ? n : null;
}

function clamp01json(n: unknown, fallback: number): number {
  return typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
}

/** Validate a client-posted frame (page-adjacent input, not trusted data).
 *  Demo frames may retain a validated data-source path from allowlisted
 *  template files; lockedTarget is always re-derived downstream. */
function makeSanitizeFrame(demoFileSet: Set<string>) {
  return (raw: unknown) => {
    const r = raw as { candidates?: unknown } | null;
    if (!r || !Array.isArray(r.candidates)) return null;
    const cleanStr = (s: unknown, n: number): string | null =>
      typeof s === "string" ? s.slice(0, n) : null;
    const cleanRect = (rect: unknown) => {
      const o = (rect ?? {}) as { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
      return {
        x: Math.round(Number(o.x) || 0),
        y: Math.round(Number(o.y) || 0),
        width: Math.max(0, Math.round(Number(o.width) || 0)),
        height: Math.max(0, Math.round(Number(o.height) || 0)),
      };
    };
    const cleanOne = (c: unknown, i: number) => {
      const o = (c ?? {}) as Record<string, unknown>;
      let filePath: string | null = null;
      let sourceLine: number | null = null;
      if (typeof o["filePath"] === "string") {
        const fp = (o["filePath"] as string).replaceAll("\\", "/");
        if (!fp.includes("..") && !fp.startsWith("/") && demoFileSet.has(fp)) {
          filePath = fp;
          sourceLine =
            Number.isInteger(o["sourceLine"]) && (o["sourceLine"] as number) > 0
              ? (o["sourceLine"] as number)
              : null;
        }
      }
      const ops = Array.isArray(o["supportedOps"])
        ? (o["supportedOps"] as unknown[])
            .filter((op) => op && typeof (op as { op?: unknown }).op === "string")
            .slice(0, 6)
            .map((op) => {
              const oo = op as { op: string; param?: unknown };
              return {
                op: oo.op.slice(0, 20),
                param: typeof oo.param === "string" ? oo.param.slice(0, 200) : null,
              };
            })
        : [];
      return {
        id: typeof o["id"] === "string" && (o["id"] as string).length > 0 ? (o["id"] as string).slice(0, 40) : `c${i}`,
        selector: cleanStr(o["selector"], 200) ?? "",
        componentName: cleanComponentName(o["componentName"]),
        filePath,
        boundingRect: cleanRect(o["boundingRect"]),
        outerHTMLSnippet: cleanStr(o["outerHTMLSnippet"], 2048) ?? "",
        htmlTruncated: o["htmlTruncated"] === true,
        confidence: clamp01json(o["confidence"], 0.5),
        trackedConfidence: clamp01json(o["trackedConfidence"], 0.5),
        supportedOps: ops,
        contextHTML:
          typeof o["contextHTML"] === "string" ? (o["contextHTML"] as string).slice(0, 1200) : null,
        screenshotCrop: null,
        sourceLine,
      };
    };
    const candidates = (r.candidates as unknown[]).slice(0, 5).map(cleanOne);
    candidates.forEach((c, i) => {
      c.id = `c${i}`;
    });
    // Boundary cast: page-adjacent input carries arbitrary op strings; the
    // typed layers downstream (compose/verify) re-validate before acting.
    return {
      candidates: candidates as unknown as GazeFrame["candidates"],
      lockedTarget: null,
      capturedAt: Date.now(),
    };
  };
}

export async function createServices(
  demoRoot: string,
  emit: (event: ShellEvent) => void,
): Promise<DemoServices> {
  const git = new GitService(demoRoot);
  const preview = new PreviewHost();
  const speech = new SpeechService([
    { kind: "web-speech", isAvailable: () => true },
    {
      kind: "scribe",
      isAvailable: () => (process.env.ELEVENLABS_API_KEY ?? "").length > 0,
    },
  ]);
  const pipeline = new PipelineMachine();

  const devServer = new DevServerManager();
  await devServer.watch(demoRoot).catch((err) => {
    console.warn(`[shell] file watch unavailable, hotReloaded always false: ${String(err)}`);
  });

  const demoFiles = await readdir(demoRoot)
    .then((fs) => fs.filter((f) => !f.startsWith(".")).join(", "))
    .catch(() => "Hero.tsx");
  const demoFileSet = new Set(demoFiles.split(", ").filter(Boolean));
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
      readParentSection: async (address) => {
        if (!address.filePath) return null;
        const text = await readFile(join(demoRoot, address.filePath), "utf8").catch(() => null);
        return text === null ? null : text.slice(0, 2000);
      },
      generateDiff: (req, ctx) =>
        generateNarrowDiff(req, {
          currentText: ctx.currentText,
          parentSection: ctx.parentSection,
          projectContext,
          lastError: ctx.lastError,
          attempt: ctx.attempt,
        }),
      buildGate: buildGateFor(demoRoot),
      didReload: () => devServer.waitForReload(2000),
    },
  });

  // Speech doubles as the pipeline entry: listening arms, off-while-idle
  // releases (mirrors the harness subscription).
  speech.onState((s) => {
    if (s === "listening") pipeline.startListening();
    if (s === "off" && pipeline.getState().stage === "listening") pipeline.reset();
    emit({ type: "speech-state", state: s });
  });
  speech.onTranscript((event) => emit({ type: "speech-transcript", event }));
  pipeline.subscribe((state) => emit({ type: "pipeline", state }));

  const useMockJev = process.env.MOCK_JEV === "1";
  const decide: DecisionLayer = useMockJev ? mockJev : createJevLayer();
  console.log(`[shell] jev: ${useMockJev ? "mockJev (MOCK_JEV=1)" : "live layer w/ mockJev fallback"}`);

  const sanitizeFrame = makeSanitizeFrame(demoFileSet);

  /** Server-side probe fallback (no live frame posted):_preview host owns the
   *  webview probe (attached by the preview manager). Throws coded errors the
   *  decide handler maps to HTTP-shaped statuses for the shared renderer. */
  const queryFrame = async (x: number, y: number): Promise<GazeFrame> => {
    const frame = await router.invoke("preview:queryElementAt", { x, y });
    if (!frame.ok) {
      const err = new Error(`preview: ${frame.message}`) as Error & { code?: number };
      err.code = frame.code === "not-ready" ? 503 : 502;
      throw err;
    }
    return frame.value;
  };

  return {
    router,
    preview,
    speech,
    pipeline,
    decide,
    devServer,
    demoRoot,
    demoFileSet,
    projectContext,
    queryFrame,
    submitEdit: (req) => router.invoke("agent:submitEdit", req),
    verify: (t, diffSummary) => verifyDecision({ transcript: t, diffSummary }),
    sanitizeFrame,
  };
}
