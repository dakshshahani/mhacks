// Preview manager (phase 2): renders the demo template to HTML in main and
// loads it into the preview <webview> as a data: URL — no harness HTTP
// server. The probe script is inlined (data: documents have no server to
// fetch a <script src> from); the guest bridge preload is a real file
// (resolveGuestPreload) so sendToHost keeps working.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { WebContents } from "electron";
import type { PreviewHost } from "@mhacks/shell";
import type { GazeFrame } from "@mhacks/contracts";

// Token styles so Tier-1 ops are VISUALLY distinguishable in the preview.
// Mirrors the renderer maps in packages/shell/src/tier1.ts (kept in sync
// with dev-server.mjs by hand — same comment lives there).
const TOKEN_CSS = [
  ".bg-brand{background:#2563eb;color:#fff}",
  ".bg-muted{background:#e5e7eb;color:#111}",
  ".bg-accent{background:#f59e0b;color:#111}",
  ".rounded-sm{border-radius:4px}.rounded-md{border-radius:8px}",
  ".rounded-lg{border-radius:16px}.rounded-full{border-radius:999px}",
  ".p-2{padding:8px}.p-4{padding:16px}.p-8{padding:32px}",
  ".gap-2{gap:8px}.gap-4{gap:16px}.gap-8{gap:32px}",
  ".text-left{text-align:left}.text-center{text-align:center}",
  ".text-right{text-align:right}.text-justify{text-align:justify}",
  ".text-2xl{font-size:1.5rem;font-weight:700}",
  ".hero{border:2px dashed #999;margin:8px}",
  ".hidden{display:none}",
].join("\n");

export class PreviewManager {
  private guest: WebContents | null = null;
  private pendingLoad = false;
  private readonly deps: {
    preview: PreviewHost;
    demoRoot: string;
    readProbeSource: () => Promise<string>;
  };

  constructor(deps: {
    preview: PreviewHost;
    demoRoot: string;
    readProbeSource: () => Promise<string>;
  }) {
    this.deps = deps;
  }

  /** Track the preview guest (first webview created under the shell). */
  attachGuest(contents: WebContents): void {
    if (this.guest && !this.guest.isDestroyed()) return;
    this.guest = contents;
    contents.once("destroyed", () => {
      if (this.guest === contents) {
        this.guest = null;
        this.syncProbe();
      }
    });
    this.syncProbe();
    if (this.pendingLoad) {
      this.pendingLoad = false;
      void this.load().catch((err) => console.error(`[shell] preview load failed: ${String(err)}`));
    }
  }

  private liveGuest(): WebContents | null {
    if (this.guest && !this.guest.isDestroyed()) return this.guest;
    return null;
  }

  /** Wire PreviewHost to the guest's inlined probe (or not-ready). */
  private syncProbe(): void {
    const guest = this.liveGuest();
    if (!guest) {
      this.deps.preview.setProbe(null, false);
      return;
    }
    const probe = async (x: number, y: number): Promise<GazeFrame> => {
      const live = this.liveGuest();
      if (!live) throw new Error("preview guest gone");
      const frame = await live.executeJavaScript(
        "window.__gazeProbe ? window.__gazeProbe.queryElementAt(x, y, 0) : null".replaceAll(
          "x, y",
          `${Math.round(x)}, ${Math.round(y)}`,
        ),
      );
      // PreviewHost re-validates shape + JSON-safety; null → wv-gone there.
      return frame as never;
    };
    this.deps.preview.setProbe(probe, true);
  }

  async renderHtml(): Promise<string> {
    const hero = await readFile(join(this.deps.demoRoot, "Hero.tsx"), "utf8")
      .then((t) => t.replace(/className=/g, "class=")) // JSX -> HTML
      .catch(() => "<!-- Hero.tsx missing -->");
    const probe = await this.deps.readProbeSource().catch(() => "");
    return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>demo preview</title><style>${TOKEN_CSS}</style></head>
<body style="font-family: system-ui; padding: 24px;">
  ${hero}
  <script>${probe}</script>
</body>
</html>`;
  }

  /** (Re)generate the preview and load it into the guest. Before the guest
   *  exists (renderer hasn't set preload / navigated yet) the load is pended.
   *  One retry on ERR_ABORTED: the renderer's about:blank kick-off and this
   *  data: load can race inside Chromium — the retry lands cleanly. */
  async load(): Promise<void> {
    const guest = this.liveGuest();
    if (!guest) {
      this.pendingLoad = true;
      return;
    }
    const html = await this.renderHtml();
    const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    try {
      await guest.loadURL(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("ABORTED")) throw err;
      await new Promise((r) => setTimeout(r, 300));
      const live = this.liveGuest();
      if (!live) {
        this.pendingLoad = true;
        return;
      }
      await live.loadURL(url);
    }
  }

  async reload(): Promise<void> {
    await this.load();
  }
}
