// ponytail: keep the preview address in the URL so refresh and shared links work.
export function localhostPreview(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username || url.password) {
    throw new Error('Use a localhost address, for example http://localhost:3001.');
  }
  return url.href;
}

const RESERVED = [
  "projects",
  "pricing",
  "about",
  "account",
  "api",
  "harness",
  "gallery",
  "new",
  "import",
  "edit",
  ".",
  "..",
];

/** Flat names plus single-level `Parent/child` rels from the scan. Slashes
 *  beyond one, empty segments, and reserved words in ANY segment are out —
 *  nested "api/…" would otherwise route into Next's /api tree. */
export function validProjectName(name: string): boolean {
  const project = name.trim();
  if (!project || project.length > 80 || project.includes("\\")) return false;
  const parts = project.split("/");
  if (parts.length > 2) return false;
  if (parts.some((p) => p.length === 0)) return false;
  if (parts.some((p) => RESERVED.includes(p.toLowerCase()))) return false;
  return true;
}

export function projectHref(name: string, preview: string): string {
  const project = name.trim();
  if (!validProjectName(project)) {
    throw new Error('Choose a project name other than a reserved page name.');
  }
  const path = project
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `/${path}?preview=${encodeURIComponent(localhostPreview(preview))}`;
}
