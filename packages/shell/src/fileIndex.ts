// Dev C: rendered component evidence -> file search (foreign-project editing).
// The template demo never needs this (data-source attrs stamp every element),
// but foreign pages carry no file stamps: the probe reports a componentName
// from React fiber, and this module turns it into root-relative file paths.
// Deterministic by construction (score desc, path asc) — ordering is part of
// downstream Jev-adjacent inputs, so it must never vary run to run.
// Regex-escaped internally: componentName originates in page content.

import { promises as fs } from "node:fs";
import * as path from "node:path";

export interface FileMatch {
  /** Project-root-relative path with platform separators. */
  path: string;
  /** 2 = filename match, 1 = definition match. */
  score: 2 | 1;
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".mhacks-snapshots",
]);

// The probe works with any webview, not only React. Keep the source index
// broad enough for plain HTML and common component formats so rendered
// markup can still map back to the file that owns it.
const SOURCE_EXTS = new Set([
  ".html",
  ".htm",
  ".tsx",
  ".ts",
  ".jsx",
  ".js",
  ".mdx",
  ".vue",
  ".svelte",
  ".astro",
]);

const MAX_FILES_VISITED = 2000;
const MAX_FILE_BYTES = 200 * 1024;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function baseNoExt(rel: string): string {
  const base = path.basename(rel);
  const ext = path.extname(base);
  return ext ? base.slice(0, -ext.length) : base;
}

/** Basename equality (case-insensitive) or a top-level definition. */
function definitionPattern(name: string): RegExp {
  const n = escapeRegExp(name);
  return new RegExp(
    `(?:function\\s+${n}\\b|(?:const|let|var)\\s+${n}\\s*=|class\\s+${n}\\b|export\\s+default\\s+(?:function\\s+)?${n}\\b)`,
  );
}

async function walk(
  dir: string,
  root: string,
  out: string[],
  budget: { visited: number },
): Promise<void> {
  if (budget.visited > MAX_FILES_VISITED) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  // Sorted visit order keeps results deterministic across filesystems.
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    if (budget.visited > MAX_FILES_VISITED) return;
    // Dot-entries (.next/.git/.well-known/...) never contain editable sources.
    if (e.name.startsWith(".")) continue;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      await walk(path.join(dir, e.name), root, out, budget);
    } else if (e.isFile()) {
      budget.visited += 1;
      if (!SOURCE_EXTS.has(path.extname(e.name))) continue;
      out.push(path.relative(root, path.join(dir, e.name)));
    }
  }
}

/** Root-relative source files, deterministic order. Shared by the
 *  component and text searches. */
export async function listSourceFiles(root: string): Promise<string[]> {
  const collected: string[] = [];
  await walk(root, root, collected, { visited: 0 });
  collected.sort();
  return collected;
}

/** Files containing the literal text (case-sensitive — transcript spans are
 *  quoted verbatim). For content intents the named text locates the USAGE
 *  file, which matters more than where the component is defined. */
export async function findTextFiles(
  root: string,
  text: string,
  maxHits = 20,
): Promise<string[]> {
  const needle = text.trim();
  if (needle.length < 2 || needle.length > 200) return [];
  const files = await listSourceFiles(root);
  const hits: string[] = [];
  for (const rel of files) {
    if (hits.length >= maxHits) break;
    let content: string | null = null;
    try {
      const st = await fs.stat(path.join(root, rel));
      if (st.size > MAX_FILE_BYTES) continue;
      content = await fs.readFile(path.join(root, rel), "utf8");
    } catch {
      continue;
    }
    if (content !== null && content.includes(needle)) hits.push(rel);
  }
  return hits;
}

/**
 * Find source files containing rendered-markup clues from a clicked element.
 *
 * Foreign previews do not carry data-source attributes, and React fiber names
 * are not guaranteed to correspond to a source definition (inline JSX,
 * anonymous route components, and forwardRef wrappers are common). The probe
 * still gives us stable class/text markers from the rendered element. Rank
 * files by how many independent markers they contain, then keep path order as
 * the deterministic tie-break. Only the strongest evidence tier is returned;
 * callers must still resolve ties explicitly. This function never guesses a
 * file from a weaker match when a stronger one exists.
 */
export async function findMarkupFiles(
  root: string,
  markers: readonly string[],
  maxHits = 20,
): Promise<string[]> {
  const unique = [...new Set(
    markers
      .map((marker) => marker.trim())
      .filter((marker) => marker.length >= 2 && marker.length <= 200),
  )];
  if (unique.length === 0) return [];

  const files = await listSourceFiles(root);
  const scored: Array<{ path: string; score: number }> = [];
  for (const rel of files) {
    let content: string;
    try {
      const st = await fs.stat(path.join(root, rel));
      if (st.size > MAX_FILE_BYTES) continue;
      content = await fs.readFile(path.join(root, rel), "utf8");
    } catch {
      continue;
    }
    const score = unique.reduce((total, marker) => total + (content.includes(marker) ? 1 : 0), 0);
    if (score > 0) scored.push({ path: rel, score });
  }

  scored.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const best = scored[0]?.score ?? 0;
  return scored
    .filter((match) => match.score === best)
    .slice(0, maxHits)
    .map((match) => match.path);
}

/** Ranked candidate files defining `componentName`. Empty name -> []. */
export async function findComponentFiles(
  root: string,
  componentName: string,
): Promise<FileMatch[]> {
  const name = componentName.trim();
  if (name.length === 0 || name.length > 120) return [];
  const collected = await listSourceFiles(root);
  const lowered = name.toLowerCase();
  const defRe = definitionPattern(name);
  const matches: FileMatch[] = [];
  for (const rel of collected) {
    if (baseNoExt(rel).toLowerCase() === lowered) {
      matches.push({ path: rel, score: 2 });
      continue;
    }
    let text: string | null = null;
    try {
      const st = await fs.stat(path.join(root, rel));
      if (st.size > MAX_FILE_BYTES) continue;
      text = await fs.readFile(path.join(root, rel), "utf8");
    } catch {
      continue;
    }
    if (text !== null && defRe.test(text)) matches.push({ path: rel, score: 1 });
  }
  matches.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return matches;
}
