// Dev C: dev-server manager — source of EditResult.hotReloaded truth.
// Spawn/restart the template dev server, pick a free port, pipe logs, detect
// HMR reload after each edit via file-watch. Never optimistic: hotReloaded is
// true only when a reload is actually observed.

import { spawn, type ChildProcess } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";
import * as net from "node:net";

export interface DevServerOptions {
  root: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  debounceMs?: number;
}

export function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      srv.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

export class DevServerManager {
  private proc: ChildProcess | null = null;
  private watcher: FSWatcher | null = null;
  private reloadListeners = new Set<() => void>();
  private lastReloadAt = 0;
  private logs: string[] = [];
  port: number | null = null;

  get running(): boolean {
    return this.proc !== null && this.proc.exitCode === null && this.proc.killed === false;
  }

  get logLines(): string[] {
    return [...this.logs];
  }

  get lastReload(): number {
    return this.lastReloadAt;
  }

  onReload(fn: () => void): () => void {
    this.reloadListeners.add(fn);
    return () => {
      this.reloadListeners.delete(fn);
    };
  }

  private markReloaded(): void {
    this.lastReloadAt = Date.now();
    for (const fn of this.reloadListeners) {
      try {
        fn();
      } catch {
        // Listener errors never break the server.
      }
    }
  }

  async watch(root: string, debounceMs = 120): Promise<void> {
    this.unwatch();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const watcher = watch(root, { recursive: true }, (_event: string, filename: string | null) => {
      const name = String(filename ?? "");
      if (name.includes(".mhacks-snapshots")) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => this.markReloaded(), debounceMs);
    });
    this.watcher = watcher;
  }

  unwatch(): void {
    try {
      this.watcher?.close();
    } catch {
      // ignore
    }
    this.watcher = null;
  }

  async start(opts: DevServerOptions): Promise<number> {
    await this.stop();
    this.port = await pickFreePort();
    const debounceMs = opts.debounceMs ?? 120;
    await this.watch(opts.root, debounceMs).catch(() => undefined);
    const child = spawn(opts.command, opts.args ?? [], {
      cwd: opts.root,
      env: { ...process.env, ...(opts.env ?? {}), PORT: String(this.port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.proc = child;
    const onOutput = (d: Buffer): void => {
      this.logs.push(String(d));
      if (this.logs.length > 500) this.logs.splice(0, this.logs.length - 500);
    };
    child.stdout?.on("data", onOutput);
    child.stderr?.on("data", onOutput);
    return this.port;
  }

  /** Resolve true when a reload lands within timeoutMs of calling. */
  waitForReload(timeoutMs = 2000): Promise<boolean> {
    const since = this.lastReloadAt;
    return new Promise((resolve) => {
      if (this.lastReloadAt !== since) {
        resolve(true);
        return;
      }
      const off = this.onReload(() => {
        clearTimeout(timer);
        off();
        resolve(true);
      });
      const timer = setTimeout(() => {
        off();
        resolve(this.lastReloadAt !== since);
      }, timeoutMs);
    });
  }

  async stop(): Promise<void> {
    this.unwatch();
    const child = this.proc;
    this.proc = null;
    if (!child) return;
    await new Promise<void>((resolve) => {
      const done = (): void => {
        resolve();
      };
      child.once("exit", done);
      try {
        child.kill();
      } catch {
        done();
      }
      setTimeout(done, 1500);
    });
  }
}
