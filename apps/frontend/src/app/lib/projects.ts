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
  /** Root mtime epoch ms — drives the hover tooltip's freshness copy.
   *  Absent only for pre-timestamp custom entries (treated as now). */
  editedAt?: number;
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

/** Shared envelope unwrap for the harness IpcResult-shaped routes. */
function unwrap<T>(action: string, res: Response, body: { ok: boolean; value?: T } & { message?: string }): T {
  if (!res.ok || !body.ok || body.value === undefined) throw harnessError(action, body);
  return body.value;
}

export function relativeEdited(mtimeMs: number): string {
  if (!mtimeMs) return "unknown";
  const { mins } = elapsedSince(mtimeMs);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(mtimeMs).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Shared elapsed breakdown — single Date.now() math for both freshness
 *  readers so the tile sub-line and tooltip can't drift apart. */
function elapsedSince(at: number): { secs: number; mins: number; hours: number; days: number } {
  const secs = Math.max(0, Math.round((Date.now() - at) / 1000));
  const mins = Math.floor(secs / 60);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  return { secs, mins, hours, days };
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/** Hover-tooltip freshness: full unit ladder (seconds → years), always a
 *  short single line that fits the 273px HiFi card. Mirrors the HiFi tooltip
 *  ("Last updated: 15 seconds ago"). */
export function tooltipFresh(project: Project): string {
  const at = project.editedAt ?? Date.now();
  const { secs, mins, hours, days } = elapsedSince(at);
  if (secs < 5) return "Last updated: just now";
  if (secs < 60) return `Last updated: ${plural(secs, "second")} ago`;
  if (mins < 60) return `Last updated: ${plural(mins, "minute")} ago`;
  if (hours < 24) return `Last updated: ${plural(hours, "hour")} ago`;
  if (days < 7) return `Last updated: ${plural(days, "day")} ago`;
  if (days < 30) return `Last updated: ${plural(Math.floor(days / 7), "week")} ago`;
  if (days < 365) return `Last updated: ${plural(Math.floor(days / 30), "month")} ago`;
  return `Last updated: ${plural(Math.floor(days / 365), "year")} ago`;
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
    editedAt: e.mtimeMs,
  }));
}

/** Generate = scaffold a starter site from a spoken brief, then supervise it
 *  like any gallery project. Generations outlive the 30s Next rewrite proxy,
 *  so this starts a job and polls status every 2s until ready/failed.
 *  Resolves with the preview URL to route to. Throws with the harness
 *  message for the UI to show. */
export interface GenerationJob {
  jobId: string;
  name: string;
}

export interface GenerationStatus {
  state: "generating" | "ready" | "failed";
  name: string;
  value: ActiveProject | null;
  message: string | null;
}

export async function startGeneration(prompt: string): Promise<GenerationJob> {
  const res = await fetch("/api/projects/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  const body = (await res.json()) as { ok: boolean; value?: GenerationJob } & { message?: string };
  return unwrap("generate", res, body);
}

export async function generationStatus(jobId: string): Promise<GenerationStatus> {
  const res = await fetch(`/api/projects/generate/status?jobId=${encodeURIComponent(jobId)}`, {
    cache: "no-store",
  });
  const body = (await res.json()) as { ok: boolean; value?: GenerationStatus } & { message?: string };
  return unwrap("generate status", res, body);
}

/** Poll ceiling: 6min at 2s cadence — past that the job is presumed stalled
 *  and the UI must surface retry instead of spinning forever. */
const MAX_POLLS = 180;

export async function generateProject(prompt: string): Promise<ActiveProject> {
  const { jobId } = await startGeneration(prompt);
  for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
    await new Promise((r) => setTimeout(r, 2000));
    const status = await generationStatus(jobId);
    if (status.state === "ready" && status.value) return status.value;
    if (status.state === "failed") {
      throw new Error(status.message || "Generation failed.");
    }
  }
  throw new Error("Generation timed out — retry to try again.");
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
    editedAt: Date.now(),
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
