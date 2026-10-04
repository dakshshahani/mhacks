// Packaged full-app supervision (no launcher exists packaged): seed the
// demo, fork the harness backend + Next standalone server under plain node
// (ELECTRON_RUN_AS_NODE turns our own binary into a node shim), wait for
// both, hand the frontend URL to the window. Dev never enters here (the
// launcher supervises there and sets APP_URL / MHACKS_SHELL_ONLY).
//
// Child logs append to userData/logs (packaged stdout goes nowhere visible).

import { spawn, type ChildProcess } from "node:child_process";
import * as net from "node:net";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { electron } from "./electron";
import { appRoot, resolveDemoRoot } from "./paths";

const { app } = electron;

function logFile(name: string): (line: string) => void {
  const dir = join(app.getPath("userData"), "logs");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.log`);
  return (line: string) => {
    try {
      appendFileSync(file, line);
    } catch {
      // Logging must never break supervision.
    }
  };
}

function pipe(child: ChildProcess, log: (line: string) => void, label: string): void {
  child.stdout?.on("data", (d: Buffer) => log(`[${label}] ${String(d)}`));
  child.stderr?.on("data", (d: Buffer) => log(`[${label}:err}] ${String(d)}`));
}

async function portTaken(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: "localhost", autoSelectFamily: true });
    s.once("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.once("error", () => resolve(false));
  });
}

// Connect-probe, NOT bind-probe: a bind test on 127.0.0.1 cannot see a
// listener on ::: (dual-stack split), so two servers would share the port
// and steal each other's traffic. A connect() sees whoever answers.
// MHACKS_HARNESS_PORT / MHACKS_FRONTEND_PORT pin ports (tests, conflicts).
async function pickFreePort(start: number, pinned?: string): Promise<number> {
  if (pinned) return Number(pinned);
  let port = start;
  while (await portTaken(port)) port += 1;
  return port;
}

async function waitForOk(url: string, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      await res.arrayBuffer().catch(() => null);
      if (res.ok || res.status < 500) return;
    } catch {
      // Not up yet.
    }
    if (Date.now() >= deadline) throw new Error(`${label} never came up at ${url}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

const children: ChildProcess[] = [];

export function stopSupervised(): void {
  for (const child of children) {
    try {
      child.kill();
    } catch {
      // Already gone.
    }
  }
  children.length = 0;
}

/** Plain-node fork of our own binary (ELECTRON_RUN_AS_NODE=1). */
function forkNode(entry: string, env: Record<string, string>, label: string, cwd?: string): ChildProcess {
  const child = spawn(process.execPath, [entry], {
    cwd,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  pipe(child, logFile(label), label);
  child.on("exit", (code) => {
    logFile(label)(`[supervisor] ${label} exited (${code})\n`);
  });
  children.push(child);
  return child;
}

export async function bootPackagedFullApp(): Promise<{ frontendUrl: string }> {
  const demoRoot = resolveDemoRoot();
  console.log(`[electron] packaged full-app; demo root: ${demoRoot}`);

  // 1. Harness backend (bundled; DEMO_ROOT keeps snapshots in userData).
  const harnessPort = await pickFreePort(5173, process.env.MHACKS_HARNESS_PORT);
  forkNode(join(appRoot, "dist-electron", "harness.mjs"), {
    PORT: String(harnessPort),
    DEMO_ROOT: demoRoot,
  }, "harness");
  await waitForOk(`http://127.0.0.1:${harnessPort}/api/projects/active`, 60000, "harness");
  console.log(`[electron] harness on :${harnessPort}`);

  // 2. Next standalone server (built at pack time; rewrites read HARNESS_URL
  // at server start, so the picked port is wired here, not at build time).
  const frontendDir = join(process.resourcesPath, "frontend");
  const frontendPort = await pickFreePort(3000, process.env.MHACKS_FRONTEND_PORT);
  forkNode(join(frontendDir, "server.js"), {
    PORT: String(frontendPort),
    HARNESS_URL: `http://127.0.0.1:${harnessPort}`,
    // Deps ship as frontend-deps (builder drops node_modules from
    // extraResources); standalone server.js is CJS so NODE_PATH applies.
    NODE_PATH: join(frontendDir, "frontend-deps"),
  }, "frontend", frontendDir);
  // NOTE: the window MUST load `localhost`, never 127.0.0.1 — the
  // Next/Turbopack dev runtime silently never hydrates on 127.0.0.1
  // (docs/electron.md lesson 0). Production server hydrates either way,
  // but localhost keeps dev/prod identical.
  await waitForOk(`http://127.0.0.1:${frontendPort}/`, 120000, "frontend");
  const frontendUrl = `http://localhost:${frontendPort}/`;
  console.log(`[electron] frontend on :${frontendPort}`);
  return { frontendUrl };
}
