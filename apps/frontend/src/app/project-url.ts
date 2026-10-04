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

export function validProjectName(name: string): boolean {
  return Boolean(name.trim()) && name.length <= 80 && !/[\/\\]/.test(name) &&
    !['projects', 'pricing', 'about', 'account', 'api', 'harness', '.', '..'].includes(name.toLowerCase());
}

export function projectHref(name: string, preview: string): string {
  const project = name.trim();
  if (!validProjectName(project)) {
    throw new Error('Choose a project name other than a reserved page name.');
  }
  return `/${encodeURIComponent(project)}?preview=${encodeURIComponent(localhostPreview(preview))}`;
}
