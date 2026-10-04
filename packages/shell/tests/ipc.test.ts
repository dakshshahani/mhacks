// IPC router: every invoke returns an envelope; git/speech/preview wired.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { GitService } from "../src/git";
import { PreviewHost } from "../src/preview";
import { SpeechService } from "../src/speech";
import { IpcRouter } from "../src/ipcRouter";
import type { GazeFrame } from "@mhacks/contracts";

const FRAME: GazeFrame = {
  candidates: [
    {
      id: "c0",
      selector: "h1",
      componentName: "Hero",
      filePath: "Hero.tsx",
      boundingRect: { x: 1, y: 2, width: 3, height: 4 },
      outerHTMLSnippet: "<h1>Hi</h1>",
      htmlTruncated: false,
      confidence: 1,
      trackedConfidence: 1,
      supportedOps: [],
    },
  ],
  lockedTarget: null,
  capturedAt: 1,
};

async function makeRouter() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mhacks-ipc-"));
  await fs.writeFile(path.join(root, "Hero.tsx"), `<div className="hero">Hello</div>`);
  const git = new GitService(root);
  const preview = new PreviewHost();
  preview.setProbe(() => Promise.resolve(FRAME), true);
  const speech = new SpeechService([{ kind: "web-speech", isAvailable: () => true }]);
  const router = new IpcRouter({
    git,
    preview,
    speech,
    executorDeps: {
      readFile: (p) => fs.readFile(p, "utf8"),
      writeFile: (p, t) => fs.writeFile(p, t, "utf8").then(() => undefined),
      resolveRoot: (f) => (f ? path.join(root, f) : root),
    },
  });
  return { router, root };
}

describe("ipc router", () => {
  it("preview + calibration channels", async () => {
    const { router } = await makeRouter();
    const q = await router.invoke("preview:queryElementAt", { x: 1, y: 2 });
    assert.equal(q.ok, true);
    const cal = await router.invoke("preview:setCalibration", { status: "calibrated" });
    assert.equal(cal.ok, true);
    assert.equal(router.getCalibration(), "calibrated");
  });

  it("git channels round-trip; empty undo -> not-ready", async () => {
    const { router } = await makeRouter();
    const emptyUndo = await router.invoke("git:undo", undefined);
    assert.equal(emptyUndo.ok, false);
    if (emptyUndo.ok) return;
    assert.equal(emptyUndo.code, "not-ready");

    const snap = await router.invoke("git:createSnapshot", { label: "v1" });
    assert.equal(snap.ok, true);
    const hist = await router.invoke("git:history", undefined);
    assert.equal(hist.ok, true);
    if (!hist.ok) return;
    assert.equal(hist.value.length, 2); // gaze: initial + v1
    if (!snap.ok) return;
    const conf = await router.invoke("git:confirm", { sha: snap.value.sha });
    assert.equal(conf.ok, true);
  });

  it("git checkout views without moving the tip; revertTo drops above", async () => {
    const { router } = await makeRouter();
    const v1 = await router.invoke("git:createSnapshot", { label: "v1" });
    assert.equal(v1.ok, true);
    if (!v1.ok) return;
    const v2 = await router.invoke("git:createSnapshot", { label: "v2" });
    assert.equal(v2.ok, true);
    if (!v2.ok) return;

    const co = await router.invoke("git:checkout", { sha: v1.value.sha });
    assert.equal(co.ok, true);
    const stillTwo = await router.invoke("git:history", undefined);
    assert.equal(stillTwo.ok, true);
    if (!stillTwo.ok) return;
    assert.equal(stillTwo.value.length, 3); // session branch: initial + v1 + v2 (tip untouched)

    const bad = await router.invoke("git:checkout", { sha: "deadbeefdeadbeef" });
    assert.equal(bad.ok, false);

    const rev = await router.invoke("git:revertTo", { sha: v1.value.sha });
    assert.equal(rev.ok, true);
    const after = await router.invoke("git:history", undefined);
    assert.equal(after.ok, true);
    if (!after.ok) return;
    assert.deepEqual(
      after.value.map((s) => s.label),
      ["gaze: initial", "v1"],
    );
  });

  it("speech start/stop envelopes", async () => {
    const { router } = await makeRouter();
    const start = await router.invoke("speech:start", undefined);
    assert.equal(start.ok, true);
    const stop = await router.invoke("speech:stop", undefined);
    assert.equal(stop.ok, true);
  });

  it("agent:submitEdit end-to-end via channels (G1 crossing)", async () => {
    const { router } = await makeRouter();
    const res = await router.invoke("agent:submitEdit", {
      id: "e-1",
      transcript: "make it brand",
      intent: "style",
      target: FRAME.candidates[0] as never,
      op: { op: "set-color", param: "brand" },
      route: "no-llm",
      riskScore: 0.1,
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.value.status, "applied");
    assert.ok(res.value.commitSha.length > 0);
  });

  it("unknown channel -> unknown envelope, never throws", async () => {
    const { router } = await makeRouter();
    const res = await (router.invoke as (c: string, r: unknown) => Promise<{ ok: boolean }>)(
      "nope:missing",
      {},
    );
    assert.equal(res.ok, false);
  });
});
