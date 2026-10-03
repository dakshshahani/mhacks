// Dev B: Flash-Lite narrow-diff generator (grill-locked code model, thinking off).
// Seam note: this does NOT implement CodeAgent.submitEdit — that truth boundary
// (apply + pre-commit + real commitSha) belongs to Dev C's executor. The
// executor calls generateNarrowDiff for small/large routes, applies the diff in
// the worktree, and returns the truthful EditResult.

import { CODE_MODEL, type EditRequest } from "@mhacks/contracts";
import { env } from "./env";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = 30000;
const MAX_OUTPUT_TOKENS = 2048;

export function buildEditPrompt(req: EditRequest): string;
export function buildEditPrompt(req: EditRequest, ctx: DiffContext): string;
export function buildEditPrompt(req: EditRequest, ctx?: DiffContext): string {
  const t = req.target;
  const lines = [
    "You are a code-editing micro-model. Output ONLY a unified diff. No prose.",
    `Intent: ${req.intent}`,
    `Transcript: ${req.transcript}`,
    `Component: ${t.componentName ?? "unknown"} File: ${t.filePath ?? "unknown"}`,
    `HTML: ${t.outerHTMLSnippet}`,
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
  if (ctx?.parentSection) {
    lines.push(`Enclosing file context:\n${ctx.parentSection.slice(0, 2000)}`);
  }
  if (ctx && ctx.attempt > 0 && ctx.lastError) {
    lines.push(
      `Previous attempt ${ctx.attempt} failed the build gate: ${ctx.lastError}. ` +
        "Fix the error and output ONLY the corrected unified diff.",
    );
  }
  return lines.join("\n");
}

interface GenerateContentResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

export interface FlashLiteOptions {
  apiKey?: string;
  modelId?: string;
  logger?: { warn(...args: unknown[]): void };
  /** Executor retry context (parentSection/attempt/lastError) — appended to
   *  the prompt so build-gate retries are error-fed per the grill lock. */
  context?: DiffContext;
}

/** Retry context shape mirrors ExecutorDeps.generateDiff's second arg. */
export interface DiffContext {
  parentSection: string | null;
  attempt: number;
  lastError: string | null;
}

/** Returns the unified diff text, or null when unusable (caller treats as build-fail). */
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
  const context = options.context;
  const prompt = context ? buildEditPrompt(req, context) : buildEditPrompt(req);
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
            { role: "user", parts: [{ text: prompt }] },
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
    const text = parts
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    return text.length > 0 ? text : null;
  } catch (err) {
    options.logger?.warn(
      "[flash] failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
