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

/** Flat top-level names only — nested rels were tried and removed; the scan
 *  lists runnable top-level dirs, so routing stays one segment. Reserved
 *  words cover every real route (a project literally named "new" would
 *  swallow /new). */
export function validProjectName(name: string): boolean {
  const project = name.trim();
  if (!project || project.length > 80) return false;
  if (project === "." || project === "..") return false;
  if (/[/\\]/.test(project)) return false;
  if (RESERVED.includes(project.toLowerCase())) return false;
  return true;
}

export function projectHref(name: string, preview: string): string {
  const project = name.trim();
  if (!validProjectName(project)) {
    throw new Error('Choose a project name other than a reserved page name.');
  }
  return `/${encodeURIComponent(project)}?preview=${encodeURIComponent(localhostPreview(preview))}`;
}
