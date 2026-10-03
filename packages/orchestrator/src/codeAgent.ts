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
  /** Previous build-gate failure (error-fed retry, grill-locked). */
  lastError?: string | null;
  attempt?: number;
}

export function buildEditPrompt(req: EditRequest, files: EditFileContext = {}): string {
  const t = req.target;
  const lines = [
    "You are a code-editing micro-model. Output ONLY the complete updated file content. No prose, no explanations, no diff markers, no code fences.",
    "Rules: reproduce the current file below with exactly the requested edit applied. Preserve every data-source=\"...\" attribute byte-for-byte — never remove or renumber them. Change nothing else: no reformatting, no new imports, no extra elements.",
    `Intent: ${req.intent}`,
    `Transcript: ${req.transcript}`,
    `Component: ${t.componentName ?? "unknown"} File: ${t.filePath ?? "unknown"}`,
    `Target element — apply the edit HERE, not to parents or siblings: selector=${t.selector} HTML=${t.outerHTMLSnippet}`,
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
  if (options.lastError !== undefined && options.lastError !== null) {
    ctx.lastError = options.lastError;
  }
  if (options.attempt !== undefined) ctx.attempt = options.attempt;
  return ctx;
}

/** Returns the complete replacement file text, or null when unusable (caller treats as build-fail). */
export async function generateNarrowDiff(
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
              parts: [{ text: buildEditPrompt(req, editFileContext(options)) }],
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
