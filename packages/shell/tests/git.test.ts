// Git service: real git — one commit per snapshot, undo steps the tip back,
// checkout detaches to view, revertTo force-moves the branch.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { GitService } from "../src/git";

function git(root: string, ...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", ["-C", root, ...args], (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr).trim() || err.message));
      else resolve(String(stdout).trim());
    });
  });
}

async function makeRoot(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mhacks-git-"));
  await fs.writeFile(path.join(dir, "Hero.tsx"), `<div className="hero">Hello</div>`);
  return dir; // the service auto-inits a nested repo on first snapshot
}

async function labels(gitSvc: GitService): Promise<string[]> {
  return (await gitSvc.history()).map((s) => s.label);
}

describe("GitService", () => {
  it("snapshot -> edit -> undo restores, one commit per snapshot", async () => {
    const root = await makeRoot();
    const gitSvc = new GitService(root);
    const s1 = await gitSvc.createSnapshot("v1");
    assert.match(s1.sha, /^[0-9a-f]{40}$/);
    assert.ok(s1.at > 0);

    await fs.writeFile(path.join(root, "Hero.tsx"), `<div className="hero">Edited</div>`);
    const s2 = await gitSvc.createSnapshot("edit e-1");
    assert.notEqual(s1.sha, s2.sha);
    assert.deepEqual(await labels(gitSvc), ["gaze: initial", "v1", "edit e-1"]);

    const { snap } = await gitSvc.undo();
    assert.ok(snap.sha.length === 40);
    const text = await fs.readFile(path.join(root, "Hero.tsx"), "utf8");
    assert.match(text, /Hello/);
    assert.deepEqual(await labels(gitSvc), ["gaze: initial", "v1"]);

    const hist = await gitSvc.history();
    for (const h of hist) {
      assert.ok(h.sha.length === 40 && h.label.length > 0 && h.at > 0);
    }
  });

  it("consecutive undos walk back through edits instead of oscillating", async () => {
    const root = await makeRoot();
    const gitSvc = new GitService(root);
    await gitSvc.createSnapshot("v1");
    await fs.writeFile(path.join(root, "Hero.tsx"), `<div className="hero">One</div>`);
    await gitSvc.createSnapshot("v2");
    await fs.writeFile(path.join(root, "Hero.tsx"), `<div className="hero">Two</div>`);
    await gitSvc.createSnapshot("v3");

    await gitSvc.undo();
    assert.match(await fs.readFile(path.join(root, "Hero.tsx"), "utf8"), /One/);
    await gitSvc.undo();
    assert.match(await fs.readFile(path.join(root, "Hero.tsx"), "utf8"), /Hello/);
    await gitSvc.undo();
    assert.match(await fs.readFile(path.join(root, "Hero.tsx"), "utf8"), /Hello/); // the auto baseline
    // Fourth undo: past the initial baseline.
    await assert.rejects(() => gitSvc.undo(), /nothing to undo/);
  });

  it("checkout detaches to view without moving the tip; revertTo drops everything above", async () => {
    const root = await makeRoot();
    const gitSvc = new GitService(root);
    const s1 = await gitSvc.createSnapshot("v1");
    await fs.writeFile(path.join(root, "Hero.tsx"), `<div className="hero">Two</div>`);
    const s2 = await gitSvc.createSnapshot("v2");
    await fs.writeFile(path.join(root, "Hero.tsx"), `<div className="hero">Three</div>`);
    await gitSvc.createSnapshot("v3");
    const tipBefore = await git(root, "rev-parse", "main");

    const found = await gitSvc.checkout(s2.sha);
    assert.equal(found.sha, s2.sha);
    assert.match(await fs.readFile(path.join(root, "Hero.tsx"), "utf8"), /Two/);
    // Non-destructive: the branch tip hasn't moved.
    assert.equal(await git(root, "rev-parse", "main"), tipBefore);
    // Detached log shows ancestors only.
    assert.deepEqual(await labels(gitSvc), ["gaze: initial", "v1", "v2"]);

    await gitSvc.revertTo(s1.sha);
    assert.match(await fs.readFile(path.join(root, "Hero.tsx"), "utf8"), /Hello/);
    assert.equal(await git(root, "rev-parse", "main"), s1.sha);
    assert.deepEqual(await labels(gitSvc), ["gaze: initial", "v1"]);

    await assert.rejects(() => gitSvc.checkout("deadbeefdeadbeef"), /unknown sha/);
  });

  it("committing while detached returns to latest first (clean tree)", async () => {
    const root = await makeRoot();
    const gitSvc = new GitService(root);
    await gitSvc.createSnapshot("v1");
    await fs.writeFile(path.join(root, "Hero.tsx"), `<div className="hero">Two</div>`);
    await gitSvc.createSnapshot("v2");
    await gitSvc.checkout((await gitSvc.history())[0]?.sha as string);
    assert.equal(await git(root, "branch", "--show-current"), "");

    // Fresh instance (no stored branch) resolves the single local branch.
    const fresh = new GitService(root);
    await fresh.createSnapshot("v3");
    assert.equal(await git(root, "branch", "--show-current"), "main");
    assert.deepEqual(await labels(fresh), ["gaze: initial", "v1", "v2", "v3"]);
  });

  it("checkout stashes uncommitted work instead of destroying it", async () => {
    const root = await makeRoot();
    const gitSvc = new GitService(root);
    const s1 = await gitSvc.createSnapshot("v1");
    await fs.writeFile(path.join(root, "Hero.tsx"), `<div className="hero">Two</div>`);
    await gitSvc.createSnapshot("v2");
    await fs.writeFile(path.join(root, "Hero.tsx"), `<div className="hero">Mine</div>`);

    await gitSvc.checkout(s1.sha);
    assert.match(await fs.readFile(path.join(root, "Hero.tsx"), "utf8"), /Hello/);
    assert.match(await git(root, "stash", "list"), /gaze: view/);
  });

  it("confirm resolves a known sha, rejects unknown", async () => {
    const root = await makeRoot();
    const gitSvc = new GitService(root);
    const s = await gitSvc.createSnapshot("v1");
    const found = await gitSvc.confirm(s.sha);
    assert.equal(found.sha, s.sha);
    await assert.rejects(() => gitSvc.confirm("deadbeefdeadbeef"), /unknown sha/);
  });

  it("undo with no commits throws (router maps to not-ready)", async () => {
    const root = await makeRoot();
    const gitSvc = new GitService(root);
    await assert.rejects(() => gitSvc.undo(), /nothing to undo/);
  });

  it("project subdir of another repo gets an isolated nested repo", async () => {
    const outer = await fs.mkdtemp(path.join(os.tmpdir(), "mhacks-outer-"));
    await git(outer, "init", "-q", "-b", "main");
    await git(outer, "config", "user.email", "t@t");
    await git(outer, "config", "user.name", "t");
    await fs.writeFile(path.join(outer, "outer.txt"), "outer");
    await git(outer, "add", "-A");
    await git(outer, "commit", "-qm", "outer commit");
    const sub = path.join(outer, "proj");
    await fs.mkdir(sub);
    await fs.writeFile(path.join(sub, "App.tsx"), "app");

    const gitSvc = new GitService(sub);
    await gitSvc.createSnapshot("v1");
    // Nested repo created inside the project dir…
    assert.ok(await fs.stat(path.join(sub, ".git")).then(() => true).catch(() => false));
    // …and the outer repo is untouched (one commit; only the untracked dir).
    assert.equal(await git(outer, "rev-list", "--count", "HEAD"), "1");
    assert.match(await git(outer, "status", "--porcelain"), /^\?\? proj\/$/);
  });

  it("edit commits scope to their files; unrelated dirty files stay out", async () => {
    const root = await makeRoot();
    const gitSvc = new GitService(root);
    await gitSvc.createSnapshot("v1");
    await fs.writeFile(path.join(root, "Hero.tsx"), `<div className="hero">Two</div>`);
    await fs.writeFile(path.join(root, "Notes.md"), "scratch");
    await gitSvc.createSnapshot("edit e-1", ["Hero.tsx"]);
    assert.equal(await git(root, "show", "--name-only", "--format=", "HEAD"), "Hero.tsx");
    assert.match(await git(root, "status", "--porcelain"), /Notes\.md/);
  });

  it("explicit versions stage everything, including untracked files", async () => {
    const root = await makeRoot();
    const gitSvc = new GitService(root);
    await fs.writeFile(path.join(root, "New.tsx"), "new");
    await gitSvc.createSnapshot("v1");
    const tracked = await git(root, "ls-files");
    assert.ok(tracked.includes("New.tsx") && tracked.includes("Hero.tsx"));
  });

  it("clean tree still snapshots (empty commit) so versions can mark time", async () => {
    const root = await makeRoot();
    const gitSvc = new GitService(root);
    await gitSvc.createSnapshot("v1");
    await gitSvc.createSnapshot("v2");
    assert.deepEqual(await labels(gitSvc), ["gaze: initial", "v1", "v2"]);
  });

  it("history is oldest-first with full shas, labels, and timestamps", async () => {
    const root = await makeRoot();
    const gitSvc = new GitService(root);
    await gitSvc.createSnapshot("v1");
    await gitSvc.createSnapshot("v2");
    const hist = await gitSvc.history();
    assert.equal(hist.length, 3);
    assert.ok(hist[0] && /^[0-9a-f]{40}$/.test(hist[0].sha));
    assert.ok(hist.every((h) => h.label.length > 0 && h.at > 0));
    assert.ok((hist[0]?.at ?? 0) <= (hist[1]?.at ?? 0));
  });

  it("undo stashes a dirty tree instead of destroying it", async () => {
    const root = await makeRoot();
    const gitSvc = new GitService(root);
    await gitSvc.createSnapshot("v1");
    await fs.writeFile(path.join(root, "Hero.tsx"), `<div className="hero">Two</div>`);
    await gitSvc.createSnapshot("v2");
    await fs.writeFile(path.join(root, "Hero.tsx"), `<div className="hero">Mine</div>`);
    await gitSvc.undo();
    assert.match(await fs.readFile(path.join(root, "Hero.tsx"), "utf8"), /Hello/);
    const stash = await git(root, "stash", "list");
    assert.match(stash, /gaze: undo/);
    assert.match(await git(root, "stash", "show", "-p", "stash@{0}"), /Mine/);
  });

  it("undo past the initial baseline throws", async () => {
    const root = await makeRoot();
    const gitSvc = new GitService(root);
    await gitSvc.createSnapshot("v1");
    await gitSvc.undo(); // back to gaze: initial
    assert.deepEqual(await labels(gitSvc), ["gaze: initial"]);
    await assert.rejects(() => gitSvc.undo(), /nothing to undo/);
  });

  it("checkout of the tip while attached stays attached (no detach)", async () => {
    const root = await makeRoot();
    const gitSvc = new GitService(root);
    const s1 = await gitSvc.createSnapshot("v1");
    await gitSvc.checkout(s1.sha);
    assert.equal(await git(root, "branch", "--show-current"), "main");
  });

  it("checkout and confirm accept short shas", async () => {
    const root = await makeRoot();
    const gitSvc = new GitService(root);
    const s1 = await gitSvc.createSnapshot("v1");
    await fs.writeFile(path.join(root, "Hero.tsx"), `<div className="hero">Two</div>`);
    await gitSvc.createSnapshot("v2");
    const short = s1.sha.slice(0, 8);
    await gitSvc.checkout(short);
    assert.match(await fs.readFile(path.join(root, "Hero.tsx"), "utf8"), /Hello/);
    assert.equal((await gitSvc.confirm(short)).sha, s1.sha);
  });

  it("revertTo an unknown sha rejects without touching the tree", async () => {
    const root = await makeRoot();
    const gitSvc = new GitService(root);
    await gitSvc.createSnapshot("v1");
    await assert.rejects(() => gitSvc.revertTo("deadbeefdeadbeef"), /unknown sha/);
    assert.deepEqual(await labels(gitSvc), ["gaze: initial", "v1"]);
  });

  it("revertTo stashes a dirty tree first", async () => {
    const root = await makeRoot();
    const gitSvc = new GitService(root);
    const s1 = await gitSvc.createSnapshot("v1");
    await fs.writeFile(path.join(root, "Hero.tsx"), `<div className="hero">Two</div>`);
    await gitSvc.createSnapshot("v2");
    await fs.writeFile(path.join(root, "Hero.tsx"), `<div className="hero">Mine</div>`);
    await gitSvc.revertTo(s1.sha);
    assert.match(await fs.readFile(path.join(root, "Hero.tsx"), "utf8"), /Hello/);
    assert.match(await git(root, "stash", "list"), /gaze: revert/);
  });

  it("reattach is a no-op when attached, even with no commits yet", async () => {
    const root = await makeRoot();
    const gitSvc = new GitService(root);
    assert.deepEqual(await gitSvc.reattach(), { switched: false });
  });

  it("reattach on detached multi-branch with a fresh instance refuses to guess", async () => {
    const root = await makeRoot();
    const gitSvc = new GitService(root);
    await gitSvc.createSnapshot("v1");
    await git(root, "branch", "feature");
    await gitSvc.checkout((await gitSvc.history())[0]?.sha as string);
    assert.equal(await git(root, "branch", "--show-current"), "");
    await assert.rejects(() => new GitService(root).reattach(), /no single branch/);
  });
});
