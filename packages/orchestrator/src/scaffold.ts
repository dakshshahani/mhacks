// Dev B: generate-from-brief scaffold caller (GLM, max effort).
// The codeAgent (Gemini narrow-diff) path is untouched: generation is a
// different shape (multi-file scaffold, not single-file replacement) and a
// different provider. Transport-injectable + pure parser so tests never need
// a live key. The harness route calls generateScaffold; the frontend never
// touches this module.

import { env } from "./env";
import {
  SCAFFOLD_FILES,
  SCAFFOLD_MODEL_DEFAULT,
  buildScaffoldSystemPrompt,
  buildScaffoldUserPrompt,
} from "./designPrompt";

export interface ScaffoldFile {
  path: string;
  content: string;
}

const TIMEOUT_MS = 240000;
const MAX_TOKENS = 16000;

/** Provider config: env-driven, opencode Zen compatible
 *  (POST {base}/chat/completions, Bearer key — verified against
 *  https://opencode.ai/zen with glm-5.3-flash). GLM_* wins; OPENCODE_GO_*
 *  is the fallback so a stock opencode auth setup works without new vars. */
export function scaffoldConfig(): { baseUrl: string; apiKey: string; model: string } {
  const baseUrl =
    env("GLM_BASE_URL") || env("OPENCODE_GO_BASE_URL") || "https://opencode.ai/zen/v1";
  const apiKey = env("GLM_API_KEY") || env("OPENCODE_GO_API_KEY");
  const model = env("GLM_MODEL") || SCAFFOLD_MODEL_DEFAULT;
  return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey, model };
}

export interface ScaffoldTransport {
  (url: string, init: { method: string; headers: Record<string, string>; body: string }): Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
  }>;
}

export interface ScaffoldOptions {
  logger?: { warn(...args: unknown[]): void };
  transport?: ScaffoldTransport;
  timeoutMs?: number;
  maxTokens?: number;
}

interface ChatCompletionsResponse {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  usage?: unknown;
  error?: { message?: string };
}

/** First fenced block wins: the model may interleave its design read as
 *  prose between blocks (allowed only as main.js comments, but enforced
 *  here anyway) — that prose must never land inside a file. */
const FENCED_BLOCK = /```(?:\w+)?\s*\n([\s\S]*?)\n?```/;

/** Parse "### FILE: <path>" fenced blocks into the fixed file set. Unknown
 *  paths, traversal, and absolute paths are dropped (fail-closed: the caller
 *  requires the full set, so junk degrades to null, never a stray write).
 *  index.html must close with </html>: a model cut off by max_tokens emits
 *  all five blocks with the page severed mid-tag (broken DOM, probe can't
 *  map it, no highlights) — that set is rejected, never written. */
export function parseScaffoldFiles(text: string): ScaffoldFile[] | null {
  const out: ScaffoldFile[] = [];
  const re = /^### FILE:\s*(\S+)\s*$/gm;
  const marks: Array<{ path: string; start: number; bodyStart: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const p = m[1];
    if (p === undefined) continue;
    marks.push({ path: p, start: m.index, bodyStart: m.index + m[0].length });
  }
  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i];
    if (!mark) continue;
    const end = marks[i + 1]?.start ?? text.length;
    const raw = text.slice(mark.bodyStart, end);
    const content = (FENCED_BLOCK.exec(raw)?.[1] ?? raw).trim();
    const p = mark.path.trim();
    if (!(SCAFFOLD_FILES as readonly string[]).includes(p)) continue;
    if (p.includes("..") || p.startsWith("/")) continue;
    if (content.length === 0) continue;
    if (out.some((f) => f.path === p)) continue;
    out.push({ path: p, content });
  }
  if (out.length !== SCAFFOLD_FILES.length) return null;
  const page = out.find((f) => f.path === "index.html");
  if (!page || !/<\/html\s*>/i.test(page.content)) return null;
  return (SCAFFOLD_FILES as readonly string[]).map((p) => out.find((f) => f.path === p)!);
}

/** Full round trip: brief -> GLM (max effort) -> validated file set.
 *  Returns null on any failure (no key, HTTP error, unusable shape) — the
 *  harness route turns that into an honest error envelope. */
export async function generateScaffold(
  brief: string,
  projectSlug: string,
  options: ScaffoldOptions = {},
): Promise<ScaffoldFile[] | null> {
  const { baseUrl, apiKey, model } = scaffoldConfig();
  if (apiKey.length === 0) {
    options.logger?.warn("[scaffold] no api key (GLM_API_KEY)");
    return null;
  }
  const cleanBrief = brief.trim().slice(0, 2000);
  if (cleanBrief.length < 3) return null;
  const body = JSON.stringify({
    model,
    max_tokens: options.maxTokens ?? MAX_TOKENS,
    temperature: 0.7,
    // GLM burns the whole budget on hidden reasoning by default (probed:
    // 2000/2000 reasoning tokens, content cut off). Low keeps the plan
    // visible in-file (as main.js comments) with the fastest round trip;
    // medium timed out at 250s under provider load (2026-10-04). "Low"
    // verified accepted, same enum family.
    reasoning_effort: "low",
    messages: [
      { role: "system", content: buildScaffoldSystemPrompt() },
      { role: "user", content: buildScaffoldUserPrompt(cleanBrief, projectSlug) },
    ],
  });
  const url = `${baseUrl}/chat/completions`;
  const init = {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body,
  };
  try {
    const res = options.transport
      ? await options.transport(url, init)
      : await fetch(url, { ...init, signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS) });
    if (!res.ok) {
      options.logger?.warn(`[scaffold] http ${(res as { status: number }).status}`);
      return null;
    }
    const data = (await res.json()) as ChatCompletionsResponse;
    if (data.error) {
      options.logger?.warn(`[scaffold] provider: ${data.error.message}`);
      return null;
    }
    const choice = data.choices?.[0];
    const text = (choice?.message?.content ?? "").trim();
    const meta = JSON.stringify({
      finish: choice?.finish_reason ?? null,
      chars: text.length,
      usage: data.usage ?? null,
    });
    if (!text) {
      options.logger?.warn(`[scaffold] empty content ${meta}`);
      return null;
    }
    const files = parseScaffoldFiles(text);
    if (!files) {
      options.logger?.warn(`[scaffold] unparseable ${meta} head=${JSON.stringify(text.slice(0, 300))}`);
    }
    return files;
  } catch (err) {
    options.logger?.warn("[scaffold] failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
