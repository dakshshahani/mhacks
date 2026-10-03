// Git service: snapshot -> edit -> undo -> history, undo persistence.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { FileGitService } from "../src/git";

async function makeRoot(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mhacks-git-"));
  await fs.writeFile(path.join(dir, "Hero.tsx"), `<div className="hero">Hello</div>`);
  return dir;
}

describe("FileGitService", () => {
  it("snapshot -> edit -> undo restores, history lists timestamped sha", async () => {
    const root = await makeRoot();
    const git = new FileGitService(root);
    const s1 = await git.createSnapshot("v1");
    assert.match(s1.sha, /^[0-9a-f]{16}$/);
    assert.ok(s1.at > 0);

    await fs.writeFile(path.join(root, "Hero.tsx"), `<div className="hero">Edited</div>`);
    const s2 = await git.createSnapshot("edit e-1");
    assert.notEqual(s1.sha, s2.sha);

    const { snap } = await git.undo();
    assert.ok(snap.sha.length > 0);
    const text = await fs.readFile(path.join(root, "Hero.tsx"), "utf8");
    assert.match(text, /Hello/);

    const hist = await git.history();
    assert.ok(hist.length >= 3);
    for (const h of hist) {
      assert.ok(h.sha.length > 0 && h.label.length > 0 && h.at > 0);
    }
  });

  it("consecutive undos walk back through edits instead of oscillating", async () => {
    const root = await makeRoot();
    const git = new FileGitService(root);
    await git.createSnapshot("pre-edit e-1");
    await fs.writeFile(path.join(root, "Hero.tsx"), `<div className="hero">One</div>`);
    await git.createSnapshot("edit e-1");
    await git.createSnapshot("pre-edit e-2");
    await fs.writeFile(path.join(root, "Hero.tsx"), `<div className="hero">Two</div>`);
    await git.createSnapshot("edit e-2");

    await git.undo();
    assert.match(await fs.readFile(path.join(root, "Hero.tsx"), "utf8"), /One/);
    await git.undo();
    assert.match(await fs.readFile(path.join(root, "Hero.tsx"), "utf8"), /Hello/);
    // Third undo: everything already undone.
    await assert.rejects(() => git.undo(), /nothing to undo/);
  });

  it("confirm resolves a known sha, rejects unknown", async () => {
    const root = await makeRoot();
    const git = new FileGitService(root);
    const s = await git.createSnapshot("v1");
    const found = await git.confirm(s.sha);
    assert.equal(found.sha, s.sha);
    await assert.rejects(() => git.confirm("deadbeefdeadbeef"), /unknown sha/);
  });

  it("undo with empty history throws (router maps to not-ready)", async () => {
    const root = await makeRoot();
    const git = new FileGitService(root);
    await assert.rejects(() => git.undo(), /nothing to undo/);
  });
});
