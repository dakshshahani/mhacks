// Bundle main for Electron (dev + packaged). Why bundle: Node (all
// runtimes, including Electron's) refuses type-stripping for TS files
// physically under node_modules/ (ERR_UNSUPPORTED_NODE_MODULES_TYPE_
// STRIPPING) — dev only worked because pnpm symlinks resolve outside
// node_modules; packaged copies break. Verified by extracting app.asar to a
// plain dir and watching the decide import throw. The bundle inlines all
// workspace TS; only "electron" stays external (real API at runtime).
// Renderer/guest/probe stay plain source files (no TS there).
import { buildSync } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "..");
const outDir = join(appDir, "dist-electron");

// [entry, outfile]: main (Electron, "electron" external) and the harness
// backend (forked plain node in the packaged app — same bundling need).
for (const [entry, outfile] of [
  [join(appDir, "src", "main", "index.ts"), join(outDir, "main.mjs")],
  [join(appDir, "src", "dev-server.mjs"), join(outDir, "harness.mjs")],
]) {
  buildSync({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    external: ["electron"],
    resolveExtensions: [".ts", ".js", ".mjs", ".json"],
    logLevel: "warning",
  });
}
// preload.cjs is dependency-free plain CJS: copy, never bundle.
mkdirSync(outDir, { recursive: true });
copyFileSync(join(appDir, "src", "preload", "preload.cjs"), join(outDir, "preload.cjs"));
console.log("[build:main] dist-electron/main.mjs + harness.mjs + preload.cjs");
