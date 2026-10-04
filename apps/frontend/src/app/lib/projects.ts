// Project gallery data (frontend-only phase).
// MOCK seam: static stand-ins for React projects on the user's laptop until
// folder access lands. Selection + user-added entries persist in localStorage;
// no file reads, no server calls. Names 1–15 mirror the Figma frame.

export interface Project {
  id: string;
  name: string;
  /** Laptop path as displayed in the tile (mock until directory access). */
  path: string;
  framework: "React";
  /** Display string ("2h ago"); real mtimes arrive with folder access. */
  lastEdited: string;
}

export const MOCK_PROJECTS: Project[] = [
  { id: "portfolio", name: "Portfolio", path: "~/code/portfolio", framework: "React", lastEdited: "2h ago" },
  { id: "studio-website", name: "Studio website", path: "~/code/studio-website", framework: "React", lastEdited: "5h ago" },
  { id: "travel-journal", name: "Travel journal", path: "~/code/travel-journal", framework: "React", lastEdited: "Yesterday" },
  { id: "habit-tracker", name: "Habit tracker", path: "~/code/habit-tracker", framework: "React", lastEdited: "Yesterday" },
  { id: "recipe-collection", name: "Recipe collection", path: "~/code/recipe-collection", framework: "React", lastEdited: "2d ago" },
  { id: "online-store", name: "Online store", path: "~/code/online-store", framework: "React", lastEdited: "3d ago" },
  { id: "design-system", name: "Design system", path: "~/code/design-system", framework: "React", lastEdited: "4d ago" },
  { id: "reading-list", name: "Reading list", path: "~/code/reading-list", framework: "React", lastEdited: "5d ago" },
  { id: "team-dashboard", name: "Team dashboard", path: "~/code/team-dashboard", framework: "React", lastEdited: "Sep 28" },
  { id: "photography", name: "Photography", path: "~/code/photography", framework: "React", lastEdited: "Sep 26" },
  { id: "personal-blog", name: "Personal blog", path: "~/code/personal-blog", framework: "React", lastEdited: "Sep 24" },
  { id: "event-page", name: "Event page", path: "~/code/event-page", framework: "React", lastEdited: "Sep 21" },
  { id: "product-launch", name: "Product launch", path: "~/code/product-launch", framework: "React", lastEdited: "Sep 18" },
  { id: "music-library", name: "Music library", path: "~/code/music-library", framework: "React", lastEdited: "Sep 15" },
  { id: "weekend-project", name: "Weekend project", path: "~/code/weekend-project", framework: "React", lastEdited: "Sep 12" },
];

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

/** User-added entries from /import (name-only until folder access lands). */
export function loadCustomProjects(): Project[] {
  if (!canStore()) return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as Partial<Project>[];
    return list
      .filter((p) => typeof p.name === "string" && p.name.length > 0)
      .map((p, i) => ({
        id: typeof p.id === "string" ? p.id : `custom-${i}`,
        name: p.name as string,
        path: typeof p.path === "string" ? p.path : "~",
        framework: "React" as const,
        lastEdited: typeof p.lastEdited === "string" ? p.lastEdited : "just now",
      }));
  } catch {
    return [];
  }
}

export function saveCustomProject(p: { name: string; path: string }): Project {
  const entry: Project = {
    id: `custom-${Date.now().toString(36)}`,
    name: p.name,
    path: p.path,
    framework: "React",
    lastEdited: "just now",
  };
  if (canStore()) {
    window.localStorage.setItem(CUSTOM_KEY, JSON.stringify([...loadCustomProjects(), entry]));
    notifyGallery();
  }
  return entry;
}

/* Reactive snapshots for useSyncExternalStore: SSR-safe (server snapshots
   are the static defaults, so first paint always matches), client takes
   over from localStorage after hydration. Same-tab writes dispatch a
   window event because "storage" only fires cross-tab. */

type GalleryListener = () => void;

// Cached project snapshot: useSyncExternalStore requires referential
// stability (a fresh array per call = infinite loop). Invalidated on every
// notification before listeners re-read.
let cachedProjects: Project[] | null = null;

export function subscribeGallery(listener: GalleryListener): () => void {
  if (typeof window === "undefined") return () => {};
  const wrapped = () => {
    cachedProjects = null;
    listener();
  };
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

export function getProjectsSnapshot(): Project[] {
  if (!cachedProjects) cachedProjects = [...loadCustomProjects(), ...MOCK_PROJECTS];
  return cachedProjects;
}

export function getProjectsServerSnapshot(): Project[] {
  return MOCK_PROJECTS;
}
