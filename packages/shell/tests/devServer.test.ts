// Dev-server manager: free-port pick, file-watch HMR truth, spawn/stop.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DevServerManager, pickFreePort } from "../src/devServer";

describe("dev-server manager", () => {
  it("picks a free port", async () => {
    const port = await pickFreePort();
    assert.ok(port > 0 && port < 65536);
  });

  it("file-watch marks HMR reload (source of hotReloaded truth)", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mhacks-dev-"));
    await fs.writeFile(path.join(root, "Hero.tsx"), "v1");
    const mgr = new DevServerManager();
    await mgr.watch(root, 30);
    let fired = false;
    mgr.onReload(() => {
      fired = true;
    });
    const seen = mgr.waitForReload(2000);
    await new Promise((r) => setTimeout(r, 60));
    await fs.writeFile(path.join(root, "Hero.tsx"), "v2");
    assert.equal(await seen, true);
    assert.equal(fired, true);
    mgr.unwatch();
  });

  it("spawn and stop a managed process with log pipe", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mhacks-dev-"));
    const mgr = new DevServerManager();
    const port = await mgr.start({ root, command: process.execPath, args: ["-e", "console.log('ready'); setInterval(()=>{}, 1000)"] });
    assert.ok(port > 0);
    await new Promise((r) => setTimeout(r, 400));
    assert.ok(mgr.logLines.join("\n").includes("ready"));
    await mgr.stop();
  });
});
