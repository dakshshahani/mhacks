// Dev C: git service as a standalone Node module (no IPC here).
// File-snapshot implementation that works against the template repo without
// requiring a git binary: snapshots live under <root>/.mhacks-snapshots/<sha>.
// Production wraps `git worktree add` behind the same interface; channels in
// ipcRouter.ts expose createSnapshot/undo/confirm/history over IPC.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";

export interface Snapshot {
  sha: string;
  label: string;
  at: number;
}

const STORE = ".mhacks-snapshots";
const MANIFEST = "manifest.json";

function makeSha(): string {
  return randomBytes(8).toString("hex");
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function walkFiles(dir: string, out: string[], root: string): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === STORE || e.name === ".git" || e.name === "node_modules") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walkFiles(full, out, root);
    } else if (e.isFile()) {
      out.push(path.relative(root, full));
    }
  }
}

async function copyFile(root: string, dest: string, rel: string): Promise<void> {
  const src = path.join(root, rel);
  const dst = path.join(dest, rel);
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.copyFile(src, dst);
}

export class FileGitService {
  readonly root: string;
  readonly storeDir: string;

  constructor(root: string, storeDir?: string) {
    this.root = root;
    this.storeDir = storeDir ?? path.join(root, STORE);
  }

  private manifestPath(): string {
    return path.join(this.storeDir, MANIFEST);
  }

  async history(): Promise<Snapshot[]> {
    if (!(await exists(this.manifestPath()))) return [];
    const raw = await fs.readFile(this.manifestPath(), "utf8");
    const list = JSON.parse(raw) as Snapshot[];
    return [...list].sort((a, b) => a.at - b.at);
  }

  private async saveHistory(list: Snapshot[]): Promise<void> {
    await fs.mkdir(this.storeDir, { recursive: true });
    await fs.writeFile(this.manifestPath(), JSON.stringify(list, null, 2));
  }

  /** Capture current tree as a snapshot (auto-commit after each agent edit). */
  async createSnapshot(label: string): Promise<Snapshot> {
    const snap: Snapshot = { sha: makeSha(), label, at: Date.now() };
    const dest = path.join(this.storeDir, snap.sha);
    await fs.mkdir(dest, { recursive: true });
    const files: string[] = [];
    if (await exists(this.root)) await walkFiles(this.root, files, this.root);
    for (const rel of files) {
      if (rel.startsWith(STORE)) continue;
      await copyFile(this.root, dest, rel);
    }
    const list = await this.history();
    list.push(snap);
    await this.saveHistory(list);
    return snap;
  }

  /** Revert to the state before the last snapshot (git-reset semantics).
   *  Pops exactly one entry and restores the new tail (or an empty tree when
   *  nothing remains). An undone entry is removed, so consecutive undos walk
   *  back through history and can never oscillate back into an undone state.
   *  Throws when history is empty (router maps to not-ready). */
  async undo(): Promise<{ snap: Snapshot; restored: boolean }> {
    const list = await this.history();
    const last = list[list.length - 1];
    if (!last) throw new Error("nothing to undo");
    const rest = list.slice(0, -1);
    const prev = rest[rest.length - 1];
    // Drop the undone snapshot dir (best-effort hygiene, not load-bearing).
    try {
      await fs.rm(path.join(this.storeDir, last.sha), { recursive: true, force: true });
    } catch {
      // ignore
    }
    const srcDir = prev ? path.join(this.storeDir, prev.sha) : null;
    // Clear tracked files (keep the store itself).
    const files: string[] = [];
    if (await exists(this.root)) await walkFiles(this.root, files, this.root);
    for (const rel of files) {
      await fs.rm(path.join(this.root, rel), { force: true });
    }
    if (srcDir && (await exists(srcDir))) {
      const snapFiles: string[] = [];
      await walkFiles(srcDir, snapFiles, srcDir);
      for (const rel of snapFiles) {
        if (rel === MANIFEST) continue;
        const s = path.join(srcDir, rel);
        const d = path.join(this.root, rel);
        await fs.mkdir(path.dirname(d), { recursive: true });
        await fs.copyFile(s, d);
      }
    }
    const snap: Snapshot = prev ?? {
      sha: makeSha(),
      label: `undo ${last.sha}`,
      at: Date.now(),
    };
    // History only ever holds checkpoints: the undone entry is gone and no
    // undo marker is appended, so undo-then-undo keeps walking back.
    await this.saveHistory(rest);
    return { snap, restored: true };
  }

  /** Power-path commit marker on a pre-commit sha. Resolves the entry. */
  async confirm(sha: string): Promise<Snapshot> {
    const list = await this.history();
    const found = list.find((s) => s.sha === sha);
    if (!found) throw new Error(`unknown sha ${sha}`);
    return found;
  }
}
