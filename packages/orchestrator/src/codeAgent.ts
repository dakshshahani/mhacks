// Dev B: Flash-Lite narrow-diff generator (grill-locked code model, thinking off).
// Seam note: this does NOT implement CodeAgent.submitEdit — that truth boundary
// (apply + pre-commit + real commitSha) belongs to Dev C's executor. The
// executor calls generateNarrowDiff for small/large routes, applies the result in
// the worktree, and returns the truthful EditResult.
//
// Format contract with the executor: the model returns COMPLETE replacement
// file content (never a unified diff — applying diffs is Dev C+1 work), so the
// prompt always carries the current file text plus the data-source
// preservation rule the build gate enforces.

import { CODE_MODEL, type EditRequest } from "@mhacks/contracts";
import { env } from "./env";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = 30000;
const MAX_OUTPUT_TOKENS = 2048;

export interface EditFileContext {
  /** Full current text of the target file (from the executor). */
  currentText?: string;
  /** Parent file section resolved at apply time (§5.4b). */
  parentSection?: string | null;
  /** Template scope from Dev C (framework + file list). No wide codebase
   *  search: filePath arrives via Dev A's data-source attr, and the model
   *  must not look beyond the listed files. */
  projectContext?: string;
  /** Previous build-gate failure (error-fed retry, grill-locked). */
  lastError?: string | null;
  attempt?: number;
}

export function buildEditPrompt(req: EditRequest, files: EditFileContext = {}): string {
  const t = req.target;
  const lines = [
    "You are a code-editing micro-model. Output ONLY the complete updated file content. No prose, no explanations, no diff markers, no code fences.",
    "Rules: reproduce the current file below with exactly the requested edit applied. Preserve every data-source=\"...\" attribute byte-for-byte — never remove or renumber them. Change nothing else: no reformatting, no new imports, no extra elements.",
    "Styling vocabulary: reuse ONLY class names already present in the file, plus the catalog bg-brand / bg-muted / bg-accent. Never invent other class names (undefined classes render as invisible). For any color outside the catalog, use an inline style instead, e.g. style={{ backgroundColor: 'brown' }}.",
    "Text edits: replace the target text in place. Never add, remove, or duplicate text nodes or elements.",
    `Intent: ${req.intent}`,
    `Transcript: ${req.transcript}`,
    `Component: ${t.componentName ?? "unknown"} File: ${t.filePath ?? "unknown"}`,
    `Target element — apply the edit HERE, not to parents or siblings: selector=${t.selector} HTML=${t.outerHTMLSnippet}${typeof t.sourceLine === "number" ? ` (source ${t.filePath ?? "file"} line ${t.sourceLine})` : ""}`,
  ];
  if (req.op !== null) lines.push(`Catalog op hint: ${JSON.stringify(req.op)}`);
  if (req.references && req.references.length > 0) {
    lines.push("Referenced elements (named in the transcript — read their sizes/content for match/mirror/relative edits):");
    for (const r of req.references.slice(0, 3)) {
      lines.push(
        `- ${r.componentName ?? "?"} (${r.filePath ?? "?"}) ${Math.round(r.boundingRect.width)}px wide: ${(r.outerHTMLSnippet || "").slice(0, 500)}`,
      );
    }
  }
  if (files.parentSection) {
    lines.push(`Parent layout context (read-only, do not reproduce): ${files.parentSection.slice(0, 1000)}`);
  }
  if (files.projectContext) {
    lines.push(`Project context (template scope — work only within these files, no codebase search): ${files.projectContext.slice(0, 1000)}`);
  }
  if (files.lastError) {
    lines.push(`Previous attempt failed the build gate with: ${files.lastError}. Fix only that; keep everything else identical.`);
  }
  lines.push(`Current file content of ${t.filePath ?? "unknown"}:`);
  lines.push(files.currentText ?? t.outerHTMLSnippet);
  return lines.join("\n");
}

interface GenerateContentResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

export interface FlashLiteOptions {
  apiKey?: string;
  modelId?: string;
  logger?: { warn(...args: unknown[]): void };
  currentText?: string;
  parentSection?: string | null;
  projectContext?: string;
  lastError?: string | null;
  attempt?: number;
}

/** Strip code fences the model wraps around file content anyway. */
export function stripFences(text: string): string {
  const fenced = text.match(/^```(?:\w+)?\s*\n([\s\S]*?)\n?```\s*$/);
  return fenced && fenced[1] !== undefined ? fenced[1].trim() : text;
}

/** Options → prompt context without ever assigning explicit undefined
 *  (exactOptionalPropertyTypes). */
function editFileContext(options: FlashLiteOptions): EditFileContext {
  const ctx: EditFileContext = {};
  if (options.currentText !== undefined) ctx.currentText = options.currentText;
  if (options.parentSection !== undefined && options.parentSection !== null) {
    ctx.parentSection = options.parentSection;
  }
  if (options.projectContext !== undefined) ctx.projectContext = options.projectContext;
  if (options.lastError !== undefined && options.lastError !== null) {
    ctx.lastError = options.lastError;
  }
  if (options.attempt !== undefined) ctx.attempt = options.attempt;
  return ctx;
}

export type ContentPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

/** Multimodal request parts: prompt text + the target screenshot crop when the
 *  prober supplied one (base64 PNG, data-URL prefix tolerated). Crop path is
 *  constructor-tested; no live key has exercised it yet (harness probe sends
 *  none) — confirm against the REST reference before demoing it. */
export function buildContentParts(req: EditRequest, files: EditFileContext = {}): ContentPart[] {
  const parts: ContentPart[] = [{ text: buildEditPrompt(req, files) }];
  const raw = req.target.screenshotCrop;
  if (typeof raw === "string" && raw.length > 0) {
    const data = raw.replace(/^data:image\/\w+;base64,/, "");
    if (data.length > 0) parts.push({ inline_data: { mime_type: "image/png", data } });
  }
  return parts;
}

/** Returns the complete replacement file text, or null when unusable (caller treats as build-fail). */export async function generateNarrowDiff(
  req: EditRequest,
  options: FlashLiteOptions = {},
): Promise<string | null> {
  const apiKey = options.apiKey || env("GEMINI_API_KEY");
  if (apiKey.length === 0) {
    options.logger?.warn("[flash] no api key");
    return null;
  }
  const modelId = options.modelId ?? CODE_MODEL.id;
  try {
    const res = await fetch(
      `${ENDPOINT}/${modelId}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            generationConfig: {
              temperature: CODE_MODEL.temperature,
              maxOutputTokens: MAX_OUTPUT_TOKENS,
            },
          contents: [
            {
              role: "user",
              parts: buildContentParts(req, editFileContext(options)),
            },
          ],
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      options.logger?.warn(`[flash] http ${res.status}`);
      return null;
    }
    const body = (await res.json()) as GenerateContentResponse;
    const parts = body.candidates?.[0]?.content?.parts ?? [];
    const text = stripFences(
      parts
        .map((p) => p.text ?? "")
        .join("")
        .trim(),
    );
    return text.length > 0 ? text : null;
  } catch (err) {
    options.logger?.warn(
      "[flash] failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/** Hybrid file resolution, step 2 (step 1 is the shell convention search).
 *  The model picks ONE file from the convention matches for a component the
 *  user addressed. Output is validated against the candidate list, so a
 *  hallucinating model degrades to null (fail card), never a wrong file. */

export interface FileChoiceInput {
  transcript: string;
  componentName: string;
  outerHTMLSnippet: string;
  /** Root-relative candidate paths from the convention search. */
  candidates: string[];
  /** Surrounding markup of the click (parent level). When identical text or
   *  components appear in several files, prefer the file whose surroundings
   *  match this context. */
  contextHTML?: string;
}

export interface ChooseFileOptions {
  apiKey?: string;
  modelId?: string;
  logger?: { warn(...args: unknown[]): void };
  transport?: (
    url: string,
    init: { method: string; headers: Record<string, string>; body: string },
  ) => Promise<{ ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<unknown> }>;
}

function isSafeRelPath(p: string, candidates: readonly string[]): boolean {
  return (
    candidates.includes(p) &&
    p.length > 0 &&
    !p.startsWith("/") &&
    !/(^|\/)\.\.(\/|$)/.test(p)
  );
}

export async function chooseFile(
  input: FileChoiceInput,
  options: ChooseFileOptions = {},
): Promise<string | null> {
  const apiKey = options.apiKey || env("GEMINI_API_KEY");
  if (apiKey.length === 0) {
    options.logger?.warn("[flash-pick] no api key");
    return null;
  }
  const candidates = input.candidates.filter(
    (c) => typeof c === "string" && c.length > 0 && c.length <= 300,
  );
  if (candidates.length === 0) return null;
  const prompt = [
    "You map a clicked UI component to its source file. Output ONLY JSON: {\"file\": \"<exact path from the list>\"}. No prose, no fences.",
    `User said: ${input.transcript.slice(0, 300)}`,
    `Component: ${input.componentName.slice(0, 80)}`,
    `Clicked HTML: ${input.outerHTMLSnippet.slice(0, 800)}`,
  ];
  if (typeof input.contextHTML === "string" && input.contextHTML.length > 0) {
    prompt.push(
      `Surrounding markup of the click (prefer the file whose nearby markup matches this): ${input.contextHTML.slice(0, 800)}`,
    );
  }
  prompt.push(
    "Candidate files (reply with exactly one of these):",
    ...candidates.map((c) => `- ${c}`),
  );
  const promptText = prompt.join("\n");
  const modelId = options.modelId ?? CODE_MODEL.id;
  const url = `${ENDPOINT}/${modelId}:generateContent?key=${apiKey}`;
  const init = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      generationConfig: { temperature: 0, maxOutputTokens: 256 },
      contents: [{ role: "user", parts: [{ text: promptText }] }],
    }),
  };
  try {
    const res = options.transport
      ? await options.transport(url, init)
      : await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      options.logger?.warn(`[flash-pick] http ${res.status}`);
      return null;
    }
    const body = (await res.json()) as GenerateContentResponse;
    const parts = body.candidates?.[0]?.content?.parts ?? [];
    const text = stripFences(
      parts
        .map((p) => p.text ?? "")
        .join("")
        .trim(),
    );
    const match = /\{[^{}]*"file"\s*:\s*"([^"]+)"[^{}]*\}/.exec(text);
    const file = match?.[1];
    if (typeof file !== "string" || !isSafeRelPath(file, candidates)) {
      options.logger?.warn("[flash-pick] unusable answer");
      return null;
    }
    return file;
  } catch (err) {
    options.logger?.warn(
      "[flash-pick] failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
