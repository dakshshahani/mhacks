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

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
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

    // Pop semantics: the undone entry is gone, history shrinks.
    const hist = await git.history();
    assert.equal(hist.length, 1);
    assert.equal(hist[0]?.sha, snap.sha);
    for (const h of hist) {
      assert.ok(h.sha.length > 0 && h.label.length > 0 && h.at > 0);
    }
  });

  it("consecutive undos walk back without oscillating", async () => {
    const root = await makeRoot();
    const git = new FileGitService(root);
    const read = () => fs.readFile(path.join(root, "Hero.tsx"), "utf8");

    await git.createSnapshot("v1"); // tree: Hello
    await fs.writeFile(path.join(root, "Hero.tsx"), `<div className="hero">B</div>`);
    await git.createSnapshot("v2"); // tree: B
    await fs.writeFile(path.join(root, "Hero.tsx"), `<div className="hero">C</div>`);
    await git.createSnapshot("v3"); // tree: C

    const u1 = await git.undo();
    assert.match(await read(), /hero">B/);
    // Returned sha is the restored checkpoint: resolvable via confirm.
    const hist1 = await git.history();
    assert.ok(hist1.some((h) => h.sha === u1.snap.sha));

    const u2 = await git.undo();
    assert.match(await read(), /Hello/);
    assert.ok((await git.history()).some((h) => h.sha === u2.snap.sha));

    // Undoing past the first snapshot clears the tree, then throws.
    await git.undo();
    assert.equal(await exists(path.join(root, "Hero.tsx")), false);
    await assert.rejects(() => git.undo(), /nothing to undo/);

    // Undone content never comes back: no oscillation.
    assert.doesNotMatch(await read().catch(() => ""), /hero">C/);
  });

  it("single executor-style pre-edit/edit pair undoes in one step", async () => {
    const root = await makeRoot();
    const git = new FileGitService(root);
    const read = () => fs.readFile(path.join(root, "Hero.tsx"), "utf8");

    await git.createSnapshot("pre-edit e-1");
    await fs.writeFile(path.join(root, "Hero.tsx"), `<div className="hero">Edited</div>`);
    await git.createSnapshot("edit e-1");

    const { snap } = await git.undo();
    assert.match(await read(), /Hello/);
    assert.ok((await git.history()).some((h) => h.sha === snap.sha));
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
