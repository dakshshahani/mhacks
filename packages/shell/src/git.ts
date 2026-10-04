// Dev C: git service as a standalone Node module (no IPC here).
// Real git behind the same interface the pipeline already speaks: one commit
// per snapshot on a session branch rooted at the opened project, `git log`
// as history, detached-HEAD checkout to view, `switch -C` to revert and drop
// what's above. Channels in ipcRouter.ts expose
// createSnapshot/undo/confirm/history/checkout/revertTo over IPC.
//
// Safety rules (this service runs against real user repos):
// - The repo is rooted exactly at the project root. When the project is a
//   subdir of another repo (e.g. the demo template), a nested repo is
//   initialized there so gaze commits can never sweep or rewind outside
//   files. Identity is repo-local (`gaze`), never global.
// - Destructive worktree ops (checkout/revertTo/undo) stash uncommitted
//   work first (`-u`, kept in the stash, never auto-popped) instead of
//   destroying it.
// - Viewing is non-destructive (detached HEAD, branch tip untouched).
//   Committing always reattaches to the session branch first, so edits land
//   on latest.

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";

export interface Snapshot {
  sha: string;
  label: string;
  at: number;
}

/** Identity + safety flags for every write command. Repo-local config is
 *  also set on init; the flags cover pre-existing repos without identity. */
const IDENTITY = [
  "-c",
  "user.name=gaze",
  "-c",
  "user.email=gaze@local",
  "-c",
  "commit.gpgsign=false",
];

function runGit(root: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", ["-C", root, ...args], { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) {
        const detail = String(stderr ?? "").trim() || err.message;
        reject(new Error(`git ${args.filter((a) => !a.startsWith("-c") && a !== "gaze" && a !== "gaze@local" && a !== "false").join(" ")} failed: ${detail}`));
      } else {
        resolve(String(stdout ?? "").trim());
      }
    });
  });
}

export class GitService {
  readonly root: string;
  private sessionBranch: string | null = null;

  constructor(root: string) {
    this.root = root;
  }

  private git(...args: string[]): Promise<string> {
    return runGit(this.root, [...IDENTITY, ...args]);
  }

  /** A repo rooted exactly here; nested-init when the project is a subdir
   *  of another repo so all gaze history stays inside the project. */
  private async ensureRepo(): Promise<void> {
    let hasDotGit = false;
    try {
      await fs.stat(path.join(this.root, ".git"));
      hasDotGit = true;
    } catch {
      hasDotGit = false;
    }
    if (!hasDotGit) {
      try {
        await this.git("init", "-q", "-b", "main");
      } catch {
        await this.git("init", "-q");
      }
    }
    // Repo-local identity so commits never depend on (or touch) global config.
    const name = await this.git("config", "user.name").catch(() => "");
    if (!name) await this.git("config", "user.name", "gaze");
    const email = await this.git("config", "user.email").catch(() => "");
    if (!email) await this.git("config", "user.email", "gaze@local");
    const attached = await this.currentBranch();
    if (attached) this.sessionBranch = attached;
  }

  private async headSha(): Promise<string | null> {
    try {
      return await this.git("rev-parse", "HEAD");
    } catch {
      return null;
    }
  }

  private async currentBranch(): Promise<string | null> {
    try {
      const b = await this.git("branch", "--show-current");
      return b || null;
    } catch {
      return null;
    }
  }

  private async localBranches(): Promise<string[]> {
    try {
      const out = await this.git("for-each-ref", "--format=%(refname:short)", "refs/heads/");
      return out.split("\n").map((s) => s.trim()).filter(Boolean);
    } catch {
      return [];
    }
  }

  /** The branch edits land on and reverts reset: last attached branch seen,
   *  else the single local branch, else an explicit error (never guess
   *  across several branches while detached). */
  private async sessionBranchName(): Promise<string> {
    if (this.sessionBranch) return this.sessionBranch;
    const attached = await this.currentBranch();
    if (attached) {
      this.sessionBranch = attached;
      return attached;
    }
    const branches = await this.localBranches();
    if (branches.length === 1 && branches[0]) {
      this.sessionBranch = branches[0];
      return branches[0];
    }
    throw new Error("detached HEAD with no single branch: switch to a branch first");
  }

  private async subjectOf(sha: string): Promise<string> {
    return this.git("log", "-1", "--format=%s", sha);
  }

  private async resolveCommit(sha: string): Promise<string> {
    try {
      return await this.git("rev-parse", "--verify", `${sha}^{commit}`);
    } catch {
      throw new Error(`unknown sha ${sha}`);
    }
  }

  /** Stash uncommitted work aside (kept in the stash, never auto-popped). */
  private async stashAside(reason: string): Promise<void> {
    const status = await this.git("status", "--porcelain");
    if (status.length > 0) {
      await this.git("stash", "push", "-u", "-m", `gaze: ${reason}`);
    }
  }

  /** Ensure edits land on the session branch: if HEAD is detached (viewing
   *  an older version), stash work aside, return to the branch, and restore
   *  stashed work. No-op when already attached. Pop conflicts abort loudly
   *  with the stash kept. */
  async reattach(): Promise<{ switched: boolean }> {
    if (!(await this.headSha())) return { switched: false }; // unborn: nothing to attach to
    const branch = await this.sessionBranchName();
    if ((await this.currentBranch()) === branch) return { switched: false };
    const status = await this.git("status", "--porcelain");
    const stashed = status.length > 0;
    if (stashed) await this.git("stash", "push", "-u", "-m", "gaze: reattach");
    try {
      await this.git("switch", branch);
    } catch {
      await this.git("switch", "-c", branch);
    }
    if (stashed) {
      try {
        await this.git("stash", "pop");
      } catch {
        throw new Error(
          "reattach conflict: your uncommitted changes are kept in the stash (see git stash list)",
        );
      }
    }
    return { switched: true };
  }

  /** Record the pristine tree as `gaze: initial` on first use, so Undo
   *  always has somewhere to go — even for the very first edit. Idempotent:
   *  no-op once any commit exists. The executor calls this pre-write (the
   *  old pre-edit baseline), so the baseline predates the mutation. */
  async ensureBaseline(): Promise<void> {
    await this.ensureRepo();
    if (await this.headSha()) return;
    await this.git("add", "-A");
    await this.git("commit", "--allow-empty", "-m", "gaze: initial");
  }

  /** Capture the tree as a commit. `files` scopes auto-commits (an edit
   *  commits its own files); omitted stages everything (explicit versions). */
  async createSnapshot(label: string, files?: string[]): Promise<Snapshot> {
    await this.ensureRepo();
    if (!(await this.headSha())) {
      await this.git("add", "-A");
      await this.git("commit", "--allow-empty", "-m", "gaze: initial");
    }
    await this.reattach();
    if (files && files.length > 0) {
      await this.git("add", "--", ...files);
    } else {
      await this.git("add", "-A");
    }
    await this.git("commit", "--allow-empty", "-m", label);
    const sha = (await this.headSha()) as string;
    if (!this.sessionBranch) this.sessionBranch = await this.currentBranch();
    return { sha, label, at: Date.now() };
  }

  /** Session-branch log, stable across detached view: checking out an
   *  older snapshot detaches HEAD, but the pane keeps listing newer
   *  versions (the branch tip never moves on checkout). */
  async history(): Promise<Snapshot[]> {
    let ref: string | null = null;
    try {
      ref = await this.sessionBranchName();
    } catch {
      ref = null;
    }
    try {
      const out = ref
        ? await this.git("log", ref, "--format=%H%x1f%s%x1f%ct%x00")
        : await this.git("log", "--format=%H%x1f%s%x1f%ct%x00");
      // git appends a newline after each record's %x00; strip exactly it.
      const list = out
        .split("\0")
        .map((rec) => rec.replace(/^\n/, ""))
        .filter(Boolean)
        .map((rec) => {
          const [sha, label, ct] = rec.split("\x1f");
          return { sha: sha ?? "", label: label ?? "", at: Number(ct) * 1000 };
        });
      return list.reverse();
    } catch {
      return [];
    }
  }

  /** Undo one commit: the branch tip steps back to its parent. Uncommitted
   *  work is stashed aside first, never destroyed. */
  async undo(): Promise<{ snap: Snapshot; restored: boolean }> {
    await this.ensureRepo();
    if (!(await this.headSha())) throw new Error("nothing to undo");
    try {
      await this.git("rev-parse", "HEAD~1");
    } catch {
      throw new Error("nothing to undo");
    }
    await this.stashAside("undo");
    await this.git("reset", "--hard", "HEAD~1");
    const sha = (await this.headSha()) as string;
    return { snap: { sha, label: await this.subjectOf(sha), at: Date.now() }, restored: true };
  }

  /** Checkout to view: detached HEAD at the commit, branch tip untouched.
   *  Clicking the tip (re)attaches to the branch instead of detaching. */
  async checkout(sha: string): Promise<Snapshot> {
    await this.ensureRepo();
    const full = await this.resolveCommit(sha);
    await this.stashAside(`view ${full.slice(0, 8)}`);
    try {
      const branch = await this.sessionBranchName();
      const tip = await this.git("rev-parse", "--verify", `refs/heads/${branch}`).catch(() => null);
      if (full === tip) {
        if ((await this.currentBranch()) !== branch) await this.git("switch", branch);
        return { sha: full, label: await this.subjectOf(full), at: Date.now() };
      }
    } catch {
      // No usable branch (fresh repo, ambiguous detach): plain checkout below.
    }
    await this.git("checkout", full);
    return { sha: full, label: await this.subjectOf(full), at: Date.now() };
  }

  /** Revert to a commit and drop everything above it: the session branch is
   *  force-moved to the commit (old tip stays recoverable via reflog). */
  async revertTo(sha: string): Promise<Snapshot> {
    await this.ensureRepo();
    const full = await this.resolveCommit(sha);
    await this.stashAside(`revert to ${full.slice(0, 8)}`);
    const branch = await this.sessionBranchName();
    await this.git("switch", "-C", branch, full);
    return { sha: full, label: await this.subjectOf(full), at: Date.now() };
  }

  /** Power-path commit marker on a pre-commit sha. Resolves the entry. */
  async confirm(sha: string): Promise<Snapshot> {
    await this.ensureRepo();
    const full = await this.resolveCommit(sha);
    return { sha: full, label: await this.subjectOf(full), at: Date.now() };
  }
}
