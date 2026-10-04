// Project gallery data — live from the harness supervisor.
// GET /api/projects scans ~/Documents/Projects (runnable dirs only:
// package.json + non-empty dev script). Selection persists in localStorage;
// the list itself is never cached across loads — every gallery visit
// re-scans, so newly added folders just appear.

export interface Project {
  id: string;
  name: string;
  /** Absolute laptop path of the project root. */
  path: string;
  framework: string;
  /** Display string ("2h ago"); derived from the root mtime. */
  lastEdited: string;
}

export interface ActiveProject {
  name: string;
  root: string;
  previewUrl: string;
  port: number;
  startedAt: number;
  running: boolean;
}

interface ScanEntry {
  name: string;
  path: string;
  framework: string;
  mtimeMs: number;
}

function harnessError(action: string, body: unknown): Error {
  const message =
    typeof body === "object" && body !== null && "message" in body && typeof body.message === "string"
      ? body.message
      : "unknown error";
  return new Error(`${action} failed: ${message}`);
}

export function relativeEdited(mtimeMs: number): string {
  if (!mtimeMs) return "unknown";
  const mins = Math.max(0, Math.round((Date.now() - mtimeMs) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(mtimeMs).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Live scan — throws on transport error or {ok:false} envelope. */
export async function fetchProjects(): Promise<Project[]> {
  const res = await fetch("/api/projects", { cache: "no-store" });
  if (!res.ok) throw new Error(`scan failed: harness returned ${res.status}`);
  const body = (await res.json()) as { ok: boolean; value?: ScanEntry[] } & { message?: string };
  if (!body.ok || !Array.isArray(body.value)) throw harnessError("scan", body);
  return body.value.map((e) => ({
    id: e.name,
    name: e.name,
    path: e.path,
    framework: e.framework,
    lastEdited: relativeEdited(e.mtimeMs),
  }));
}

/** Open = single-active supervisor spawns `pnpm dev` and waits for ready.
 *  Resolves with the preview URL to iframe. Throws with the harness message
 *  (no dev script, install failure, port/spawn failure) for the UI to show. */
export async function openProject(name: string): Promise<ActiveProject> {
  const res = await fetch("/api/projects/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const body = (await res.json()) as { ok: boolean; value?: ActiveProject } & { message?: string };
  if (!res.ok || !body.ok || !body.value) throw harnessError(`open "${name}"`, body);
  return body.value;
}

export async function fetchActiveProject(): Promise<ActiveProject | null> {
  const res = await fetch("/api/projects/active", { cache: "no-store" });
  if (!res.ok) return null;
  const body = (await res.json()) as { ok: boolean; value?: ActiveProject | null };
  if (!body.ok) return null;
  return body.value ?? null;
}

const SELECTED_KEY = "gaze:currentProject";
const CUSTOM_KEY = "gaze:customProjects";

function canStore(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadSelectedId(): string | null {
  if (!canStore()) return null;
  return window.localStorage.getItem(SELECTED_KEY);
}

export function saveSelectedId(id: string): void {
  if (!canStore()) return;
  window.localStorage.setItem(SELECTED_KEY, id);
  notifyGallery();
}

/** Kept for /import (name-only entries until folder access lands there too). */
export function saveCustomProject(p: { name: string; path: string }): Project {
  const entry: Project = {
    id: `custom-${Date.now().toString(36)}`,
    name: p.name,
    path: p.path,
    framework: "React",
    lastEdited: "just now",
  };
  if (canStore()) {
    try {
      const raw = window.localStorage.getItem(CUSTOM_KEY);
      const list = raw ? (JSON.parse(raw) as unknown[]) : [];
      window.localStorage.setItem(CUSTOM_KEY, JSON.stringify([...list, entry]));
    } catch {
      // Storage full/blocked — entry still returned for immediate use.
    }
    notifyGallery();
  }
  return entry;
}

/* Selection-only reactive snapshots for useSyncExternalStore: SSR-safe
   (server snapshot is null, first paint matches), client takes over from
   localStorage after hydration. Same-tab writes dispatch a window event
   because "storage" only fires cross-tab. The project LIST is fetched with
   useEffect in the board — never part of these snapshots. */

type GalleryListener = () => void;

export function subscribeGallery(listener: GalleryListener): () => void {
  if (typeof window === "undefined") return () => {};
  const wrapped = () => listener();
  window.addEventListener("gaze:gallery", wrapped);
  window.addEventListener("storage", wrapped);
  return () => {
    window.removeEventListener("gaze:gallery", wrapped);
    window.removeEventListener("storage", wrapped);
  };
}

function notifyGallery(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("gaze:gallery"));
}

export function getSelectionSnapshot(): string | null {
  return loadSelectedId();
}

export function getSelectionServerSnapshot(): string | null {
  return null;
}
