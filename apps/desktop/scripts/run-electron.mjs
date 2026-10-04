// dev:electron launcher (macOS): the WHOLE app in one window.
// Landing → gallery → workspace (Next frontend) backed by the harness API
// server (dev-server.mjs), with the Electron shell as host (window + media
// grants + nav guards + Keychain). One Ctrl-C kills everything WE spawned.
//
// Attach, don't duplicate: if your own harness (:5173) and frontend (:3000)
// are already healthy, the window uses them and leaves them running on quit.
// Next 16 takes a dev lockfile per dir, so a second `next dev` in
// apps/frontend ALWAYS exits — spawning is only attempted on free ports.
// Tracked ownership (spawned = we kill it, attached = hands off).
//
// MHACKS_SHELL_ONLY=1: skip both servers, file:// index.html template demo.
//
// Env passthrough: MOCK_JEV=1, ELEVENLABS_API_KEY, PORT (harness pin),
// FRONTEND_PORT (pin), ELECTRON_EXTRA_ARGS (e.g. CDP port).
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "..");
const repoRoot = join(appDir, "..", "..");

async function portTaken(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port: Number(port), host: "localhost", autoSelectFamily: true });
    s.once("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.once("error", () => resolve(false));
  });
}

async function pickPort(pinned, fallback) {
  if (pinned) return pinned;
  let port = fallback;
  while (await portTaken(port)) port += 1;
  return String(port);
}

async function fetchOk(url, timeoutMs = 3000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    await res.arrayBuffer().catch(() => null);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForOk(url, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await fetchOk(url, 3000)) return;
    if (Date.now() >= deadline) throw new Error(`${label} never came up at ${url}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

const owned = new Set();
let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of owned) {
    try {
      child.kill();
    } catch {
      // Already gone.
    }
  }
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

function track(child, label) {
  owned.add(child);
  child.on("exit", (code) => {
    if (!shuttingDown) {
      console.error(`[dev:electron] ${label} exited (${code}) — stopping everything`);
      shutdown(typeof code === "number" ? code : 1);
    }
  });
  return child;
}

// Rebuild the main bundle on every launch (~0.2s): dev always runs what is
// on disk (type-stripping fails for TS physically under node_modules/).
{
  const built = spawnSync("node", [join(appDir, "scripts", "build-main.mjs")], {
    cwd: appDir,
    stdio: "inherit",
  });
  if (built.status !== 0) {
    console.error("[dev:electron] main bundle failed — aborting");
    process.exit(built.status ?? 1);
  }
}

// Electron binary (macOS path).
const electronBin = join(
  appDir,
  "node_modules",
  "electron",
  "dist",
  "Electron.app",
  "Contents",
  "MacOS",
  "Electron",
);
if (!existsSync(electronBin)) {
  console.error("[dev:electron] Electron binary missing — run pnpm install first");
  process.exit(1);
}

const SHELL_ONLY = process.env.MHACKS_SHELL_ONLY === "1";

let APP_URL;
if (!SHELL_ONLY) {
  // 1. Harness backend (same flags as the `dev` script).
  let HARNESS_PORT = process.env.PORT ?? "5173";
  let harnessOwned = false;
  const harnessHealthy = await fetchOk(`http://127.0.0.1:${HARNESS_PORT}/api/projects/active`);
  if (!harnessHealthy) {
    if (process.env.PORT) throw new Error(`pinned harness :${HARNESS_PORT} unhealthy — free it or unset PORT`);
    HARNESS_PORT = await pickPort(null, 5174);
    const envFile = join(repoRoot, ".env");
    const harnessArgs = ["--experimental-strip-types"];
    if (existsSync(envFile)) harnessArgs.push("--env-file=../../.env");
    harnessArgs.push(
      "--import",
      "../../packages/shell/dev-register.mjs",
      "--import",
      "../../packages/orchestrator/dev-register.mjs",
      "./src/dev-server.mjs",
    );
    track(
      spawn("node", harnessArgs, {
        cwd: appDir,
        env: { ...process.env, PORT: HARNESS_PORT },
        stdio: "inherit",
      }),
      "harness",
    );
    harnessOwned = true;
    await waitForOk(`http://127.0.0.1:${HARNESS_PORT}/api/projects/active`, 30000, "harness");
  }
  console.log(
    `[dev:electron] harness :${HARNESS_PORT} (${harnessOwned ? "spawned" : "attached — left running on quit"})`,
  );

  // 2. Next frontend (rewrites proxy /api/* + /harness/* to HARNESS_URL).
  // Pairing rule: attach :3000 only when it belongs with our harness
  // (the stock :5173 pair). Anything else busy is someone's session we
  // must not steal — fail loudly instead of half-wiring.
  let FRONTEND_PORT = process.env.FRONTEND_PORT ?? "3000";
  let frontendOwned = false;
  const frontendHealthy = await fetchOk(`http://127.0.0.1:${FRONTEND_PORT}/`);
  if (!frontendHealthy) {
    if (process.env.FRONTEND_PORT) {
      throw new Error(`pinned frontend :${FRONTEND_PORT} unhealthy — free it or unset FRONTEND_PORT`);
    }
    if (await portTaken(FRONTEND_PORT)) {
      throw new Error(
        `frontend :${FRONTEND_PORT} is busy but not ours (Next dev lockfile forbids a second server in apps/frontend). ` +
          `Stop that server, or point the shell at it directly: APP_URL=http://127.0.0.1:${FRONTEND_PORT} MHACKS_SHELL_ONLY=1 pnpm --filter @mhacks/desktop dev:electron`,
      );
    }
    FRONTEND_PORT = await pickPort(null, 3001);
    track(
      spawn("pnpm", ["--filter", "@mhacks/frontend", "exec", "next", "dev", "--port", FRONTEND_PORT], {
        cwd: repoRoot,
        env: { ...process.env, HARNESS_URL: `http://127.0.0.1:${HARNESS_PORT}`, PORT: FRONTEND_PORT },
        stdio: "inherit",
      }),
      "frontend",
    );
    frontendOwned = true;
    await waitForOk(`http://127.0.0.1:${FRONTEND_PORT}/`, 120000, "frontend");
  } else if (HARNESS_PORT !== "5173") {
    throw new Error(
      `frontend :${FRONTEND_PORT} is attached but its rewrites target stock :5173, not our harness :${HARNESS_PORT}. ` +
        `Stop one of them so the pair matches (both stock, or both spawned).`,
    );
  }
  console.log(
    `[dev:electron] frontend :${FRONTEND_PORT} (${frontendOwned ? "spawned" : "attached — left running on quit"})`,
  );

  // NOTE: the window MUST load `localhost`, never a literal 127.0.0.1.
  // On 127.0.0.1 the Next/Turbopack dev runtime silently never hydrates
  // (SSR HTML renders, zero roots, zero errors) — verified by CDP fiber
  // probe. Server-to-server HARNESS_URL stays 127.0.0.1 (no DNS ambiguity).
  APP_URL = `http://localhost:${FRONTEND_PORT}/`;
  console.log(`[dev:electron] full app in window: ${APP_URL}`);
} else {
  console.log("[dev:electron] shell-only mode (file:// index.html, template demo)");
}

// 3. Electron shell on the app.
const shellEnv = { ...process.env };
if (APP_URL) shellEnv.APP_URL = APP_URL;
delete shellEnv.ELECTRON_RUN_AS_NODE;
delete shellEnv.PORT;
delete shellEnv.FRONTEND_PORT;
const extraArgs = (process.env.ELECTRON_EXTRA_ARGS ?? "").split(/\s+/).filter(Boolean);
const shell = track(
  spawn(electronBin, [appDir, ...extraArgs], { env: shellEnv, stdio: "inherit" }),
  "shell",
);
shell.on("exit", (code) => shutdown(typeof code === "number" ? code : 0));
