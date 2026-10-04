// Stage the Next production server inside apps/desktop for electron-builder
// (extraResources `from` outside the project dir resolves unreliably).
//
// Two pieces, because neither suffices alone under pnpm:
//  1. `pnpm deploy --filter @mhacks/frontend --prod`: complete production
//     node_modules (real files — Next's standalone tracer omits transitive
//     runtime deps like @swc/helpers/@next/env under pnpm strictness).
//  2. The standalone payload (server.js + .next server manifests/static)
//     overlaid on top: deploy excludes gitignored .next.
// Layout out: staged-frontend/server.js + .next/ + node_modules/.
import { rmSync, mkdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "..");
const repoRoot = join(appDir, "..", "..");
const standaloneInner = join(
  appDir,
  "..",
  "frontend",
  ".next",
  "standalone",
  "apps",
  "frontend",
);
if (!existsSync(join(standaloneInner, "server.js"))) {
  console.error(
    "[stage] standalone server.js missing — run `pnpm --filter @mhacks/frontend build` first",
  );
  process.exit(1);
}
const dest = join(appDir, "staged-frontend");
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`[stage] failed: ${cmd} ${args.join(" ")}`);
    process.exit(r.status ?? 1);
  }
}

// 1. Production dependency closure (offline: resolves from the pnpm store;
// --legacy: plain copy, no workspace injection semantics needed here).
run("pnpm", ["deploy", "--legacy", "--filter", "@mhacks/frontend", "--prod", dest], repoRoot);
// 2. Standalone server payload over the top.
run("cp", ["-R", `${join(standaloneInner, "server.js")}`, `${join(dest, "server.js")}`], appDir);
run("cp", ["-R", `${join(standaloneInner, ".next")}/`, `${join(dest, ".next")}/`], appDir);
// 2b. Static assets + public dir (Next standalone omits them by design —
// the with-docker pattern copies them alongside; without them every client
// chunk 404s and React never hydrates: stuck spinners, zero errors).
{
  const mainNext = join(appDir, "..", "frontend", ".next");
  run("cp", ["-R", `${join(mainNext, "static")}/`, `${join(dest, ".next", "static")}/`], appDir);
  const publicDir = join(appDir, "..", "frontend", "public");
  if (existsSync(publicDir)) {
    run("cp", ["-R", `${publicDir}/`, `${join(dest, "public")}/`], appDir);
  }
}
// 3. electron-builder silently drops `node_modules` from extraResources —
// ship the closure under a neutral name and point NODE_PATH at it (the
// standalone server is CJS; smoke-tested landing+gallery 200).
run("mv", [join(dest, "node_modules"), join(dest, "frontend-deps")], appDir);
// 4. Self-links first: deploy links workspace packages back into the repo
// (.pnpm/node_modules/@mhacks/* -> <repo>); following them would swallow
// gigabytes of dev tree. Nothing at runtime imports the app package by
// name, so they go. Then materialize any remaining links (store paths
// dangle packaged and abort codesign with ENOENT) via cp -RL swap.
run("rm", ["-rf", join(dest, "frontend-deps", ".pnpm", "node_modules", "@mhacks")], appDir);
{
  const materialized = `${dest}.real`;
  run("cp", ["-RL", `${dest}/`, `${materialized}/`], appDir);
  run("rm", ["-rf", dest], appDir);
  run("mv", [materialized, dest], appDir);
}
// 5. pnpm/deploy closure gaps: transitive runtime deps that Next needs at
// server boot but that aren't linked into the deployed tree (first seen:
// @swc/helpers, @next/env). Backfill from the workspace .pnpm store as real
// files. Grow this list if a packaged boot names another module.
import { readdirSync } from "node:fs";
{
  const store = join(repoRoot, "node_modules", ".pnpm");
  for (const pkg of ["@swc/helpers", "@next/env"]) {
    const parts = pkg.split("/");
    const destPkg = join(dest, "frontend-deps", ...parts);
    if (existsSync(join(destPkg, "package.json"))) continue;
    const prefix = `${parts[0]}+${parts.slice(1).join("+")}@`;
    const hit = readdirSync(store).find((d) => d.startsWith(prefix));
    if (!hit) {
      console.error(`[stage] backfill source missing for ${pkg}`);
      process.exit(1);
    }
    run("mkdir", ["-p", join(dest, "frontend-deps", parts[0])], appDir);
    run("cp", ["-RL", `${join(store, hit, "node_modules", ...parts)}/`, `${destPkg}/`], appDir);
    console.log(`[stage] backfilled ${pkg} from ${hit}`);
  }
}
console.log("[stage] staged-frontend ready");
