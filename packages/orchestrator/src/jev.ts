// Dev B: real Jev DecisionLayer client.
// Request shape mirrors the proven jev-end harness: { model, state, questions }
// over POST api.typesafe.ai/v1/systemone. Closed catalogs built at call time
// from live state. Timeout or any failure falls back to the injected stub
// (default mockJev) so the pipeline never stalls in front of judges.

import {
  POLICY,
  mockJev,
  type Decision,
  type DecisionInput,
  type DecisionLayer,
  type ElementCandidate,
  type Intent,
  type Route,
  type VerifyDecision,
} from "@mhacks/contracts";
import { env } from "./env";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-latest";

const INTENTS: readonly Intent[] = [
  "style",
  "layout",
  "content",
  "add",
  "delete",
  "other",
];
const ROUTES: readonly Route[] = ["no-llm", "small", "large"];
/** Single source for the Jev op menu. Adding an op means one entry here
 *  plus its Tier-1 executor (contracts EditOp + renderer case) — the menu
 *  must never offer what nothing executes. */
const OP_BLURBS: Record<string, string> = {
  "set-color": "Change a color token",
  "set-radius": "Change corner rounding",
  "set-spacing": "Change spacing or padding",
  "set-align": "Change text alignment",
  hide: "Hide the element",
  "swap-text": "Replace the element text",
  none: "No catalog op fits; custom code needed",
};
const OPS: readonly string[] = Object.keys(OP_BLURBS);
const PARAMS = [
  "brand",
  "muted",
  "accent",
  "sm",
  "md",
  "lg",
  "full",
  "tight",
  "normal",
  "loose",
  "left",
  "center",
  "right",
  "none",
] as const;

/** Closed choice set Jev picks from. Ordered deterministically, never shuffled. */
export interface Catalog {
  targetIds: string[];
  intents: Intent[];
  routes: Route[];
}

export function buildCatalog(input: DecisionInput): Catalog {
  const targetIds: string[] = [];
  const seen = new Set<string>();
  for (const c of input.components) {
    if (targetIds.length >= POLICY.MAX_CANDIDATES) break;
    if (!seen.has(c.id)) {
      seen.add(c.id);
      targetIds.push(c.id);
    }
  }
  return { targetIds, intents: [...INTENTS], routes: [...ROUTES] };
}

export interface JevQuestion {
  type: "noul" | "choice";
  instructions: string;
  criteria?: Record<string, string | null>;
}

export interface JevRequest {
  model: string;
  state: string;
  questions: Record<string, JevQuestion>;
}

/** State is plain text: transcript + pointer + visible list. No HTML crosses
 *  into Jev (prompt-injection rule); the LLM gets snippets, never Jev. */
export function buildState(input: DecisionInput): string {
  const p = input.pointer;
  const visible = input.components
    .slice(0, POLICY.MAX_CANDIDATES)
    .map((c) => `${c.id} ${c.componentName ?? "?"} ${c.filePath ?? "unmapped"}`)
    .join(" | ");
  return (
    `transcript: ${input.transcript}\n` +
    `pointer: (${p?.x ?? "?"},${p?.y ?? "?"}), over: ${input.pointerOver ?? "none"}\n` +
    `visible: ${visible || "none"}`
  );
}

export function buildQuestions(input: DecisionInput): Record<string, JevQuestion> {
  const { targetIds } = buildCatalog(input);
  const targetCriteria: Record<string, string | null> = {
    none: "No existing component is addressed",
  };
  for (const id of targetIds) {
    const c = input.components.find((c) => c.id === id);
    targetCriteria[id] = `${c?.componentName ?? id} (${c?.filePath ?? "unmapped"})`;
  }
  const paramCriteria: Record<string, string | null> = {};
  for (const p of PARAMS) paramCriteria[p] = null;
  if (input.textSpans) {
    input.textSpans.slice(0, 5).forEach((s, i) => {
      paramCriteria[`span${i}`] = `“${s}”`;
    });
  }
  return {
    actionable: {
      type: "noul",
      instructions:
        "The speaker is addressing the UI builder with an edit command (not background chat).",
    },
    intent: {
      type: "choice",
      instructions: "What kind of edit is requested?",
      criteria: {
        style: "Change a color, theme, or visual style",
        layout: "Change size, spacing, position, or arrangement",
        content: "Change heading or body text",
        add: "Add a new element or section",
        delete: "Hide or remove an element",
        other: "Question or anything else",
      },
    },
    target: {
      type: "choice",
      instructions: "Which visible component is the instruction about?",
      criteria: targetCriteria,
    },
    op: {
      type: "choice",
      instructions: "Which catalog edit op handles it?",
      criteria: Object.fromEntries(
        OPS.map((o) => [o, OP_BLURBS[o] ?? null]),
      ),
    },
    param: {
      type: "choice",
      instructions: "Which catalog param or text span applies?",
      criteria: paramCriteria,
    },
    route: {
      type: "choice",
      instructions: "How should the edit be produced?",
      criteria: {
        "no-llm": "Deterministic catalog patch, no model needed",
        small: "Fast small model, narrow diff",
        large: "Frontier model with build check",
      },
    },
    risk: {
      type: "choice",
      instructions: "How risky or large is the change?",
      criteria: { low: null, medium: null, high: null },
    },
    inCatalog: {
      type: "noul",
      instructions:
        "The request can be handled fully with the picked catalog op and param.",
    },
  };
}

export function buildRequest(input: DecisionInput): JevRequest {
  return {
    model: MODEL,
    state: buildState(input),
    questions: buildQuestions(input),
  };
}

export type JevTransport = (
  request: JevRequest,
  signal: AbortSignal,
) => Promise<unknown>;

/** Default transport: POST to System One. */
export function defaultTransport(
  apiKey: string,
  endpoint: string,
): JevTransport {
  return async (request, signal) => {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(request),
      signal,
    });
    if (!res.ok) throw new Error(`jev ${res.status}`);
    return (await res.json()) as unknown;
  };
}

function clamp01(n: unknown, fallback: number): number {
  if (typeof n !== "number" || Number.isNaN(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

/** Shared Jev call envelope: the hard timeout wins even against transports
 *  that ignore the abort signal, and the timer is always cleaned up. */
export async function withJevTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  const controller = new AbortController();
  const timeout = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error(message));
    }, timeoutMs);
    controller.signal.addEventListener("abort", () => clearTimeout(timer), {
      once: true,
    });
  });
  try {
    return await Promise.race([task(controller.signal), timeout]);
  } finally {
    controller.abort();
  }
}

/** Build-gate retry policy: error-fed retries while attempts remain.
 *  Gives POLICY.MAX_RETRIES its reader — the executor calls this. */
export function shouldRetry(failedAttempts: number): boolean {
  return failedAttempts < POLICY.MAX_RETRIES;
}

interface JevAnswers {
  [name: string]: {
    choice?: unknown;
    probabilities?: Record<string, unknown>;
    noul?: unknown;
  };
}

function probs(answers: JevAnswers, key: string): Record<string, number> {
  const raw = answers[key]?.probabilities ?? answers[key] ?? {};
  const out: Record<string, number> = {};
  if (typeof raw === "object" && raw !== null) {
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === "number" && !Number.isNaN(v)) out[k] = v;
    }
  }
  return out;
}

function topChoice(answers: JevAnswers, key: string): string {
  const c = answers[key]?.choice;
  return typeof c === "string" ? c : "none";
}

function noul(answers: JevAnswers, key: string): number {
  const n = answers[key]?.noul;
  return typeof n === "number" && !Number.isNaN(n) ? n : 0;
}

/** Defensive mapping: unknown Jev output can never produce an invalid Decision. */
export function sanitizeDecision(raw: unknown, input: DecisionInput): Decision {
  const answers =
    typeof raw === "object" && raw !== null
      ? ((raw as { answers?: unknown }).answers as JevAnswers | undefined)
      : undefined;
  if (!answers || typeof answers !== "object") {
    return {
      actionable: 0,
      target: null,
      intent: "other",
      op: null,
      param: null,
      route: "small",
      riskScore: 0.5,
      inCatalog: 0,
      confidence: 0,
    };
  }
  const actionable = noul(answers, "actionable");
  const validIds = new Set(input.components.map((c) => c.id));
  let target = topChoice(answers, "target");
  const targetProb = probs(answers, "target")[target] ?? 0;
  if (targetProb < 0.5 || target === "none" || !validIds.has(target)) {
    // Fallback: component under the pointer. Id-only per contract §6.1 —
    // producers must send the CandidateId (never a name/label) in
    // DecisionInput.pointerOver.
    const over = input.pointerOver;
    target =
      over !== null && over !== undefined && validIds.has(over)
        ? over
        : "none";
  }
  const resolvedTarget = target === "none" ? null : target;
  const intentRaw = topChoice(answers, "intent");
  const intent: Intent = (INTENTS as readonly string[]).includes(intentRaw)
    ? (intentRaw as Intent)
    : "other";
  const opRaw = topChoice(answers, "op");
  const op =
    opRaw === "none" || !OPS.includes(opRaw) ? null : opRaw;
  const paramRaw = topChoice(answers, "param");
  let param: string | null = null;
  if (paramRaw.startsWith("span")) {
    const spans = input.textSpans ?? [];
    param = spans[Number(paramRaw.slice(4))] ?? null;
  } else if (paramRaw !== "none") {
    param = paramRaw;
  }
  const routeRaw = topChoice(answers, "route");
  const route: Route = (ROUTES as readonly string[]).includes(routeRaw)
    ? (routeRaw as Route)
    : "small";
  const riskRaw = topChoice(answers, "risk");
  const riskScore =
    riskRaw === "low" ? 0.2 : riskRaw === "high" ? 0.9 : 0.5;
  return {
    actionable,
    target: resolvedTarget,
    intent,
    op,
    param,
    route: resolvedTarget === null ? "small" : route,
    riskScore,
    inCatalog: resolvedTarget === null ? 0 : noul(answers, "inCatalog"),
    confidence: clamp01(targetProb || actionable, 0),
  };
}

export interface Logger {
  debug(...args: unknown[]): void;
  warn(...args: unknown[]): void;
}

export interface JevLayerOptions {
  apiKey?: string;
  endpoint?: string;
  timeoutMs?: number;
  fallback?: DecisionLayer;
  transport?: JevTransport;
  logger?: Logger;
}
export function createJevLayer(options: JevLayerOptions = {}): DecisionLayer {
  const timeoutMs = options.timeoutMs ?? POLICY.DECISION_TIMEOUT_MS;
  const fallback = options.fallback ?? mockJev;
  const endpoint = options.endpoint ?? ENDPOINT;
  return {
    async decide(input: DecisionInput): Promise<Decision> {
      if (input.transcript.trim().length === 0) {
        return fallback.decide(input);
      }
      const apiKey =
        options.apiKey || env("TYPESAFE_API_KEY") || env("JEV_API_KEY");
      if (apiKey.length === 0) {
        options.logger?.warn("[jev] no api key; using fallback");
        return fallback.decide(input);
      }
      const request = buildRequest(input);
      options.logger?.debug("[jev] in", request);
      const transport = options.transport ?? defaultTransport(apiKey, endpoint);
      try {
        const raw = await withJevTimeout(
          (signal) => transport(request, signal),
          timeoutMs,
          `jev timeout after ${timeoutMs}ms`,
        );
        const decision = sanitizeDecision(raw, input);
        options.logger?.debug("[jev] out", decision);
        return decision;
      } catch (err) {
        options.logger?.warn(
          "[jev] fallback:",
          err instanceof Error ? err.message : err,
        );
        return fallback.decide(input);
      }
    },
  };
}

/**
 * Verify pass: does the applied diff match what was asked?
 * Single Jev noul call. Fail-open ({matches: 1} on outage/empty input):
 * a verifier stall must never block the demo — build gate + Undo cover it.
 * The caller compares against POLICY.RETRY_THRESHOLD and retries at most once.
 */
export interface VerifyInput {
  transcript: string;
  diffSummary: string;
}

export interface VerifyOptions {
  apiKey?: string;
  endpoint?: string;
  timeoutMs?: number;
  transport?: JevTransport;
  logger?: Logger;
}

export async function verifyDecision(
  input: VerifyInput,
  options: VerifyOptions = {},
): Promise<VerifyDecision> {
  const pass: VerifyDecision = { matches: 1 };
  if (input.transcript.trim().length === 0) return pass;
  const apiKey = options.apiKey || env("TYPESAFE_API_KEY") || env("JEV_API_KEY");
  if (apiKey.length === 0) {
    options.logger?.warn("[jev-verify] no api key; passing open");
    return pass;
  }
  const request: JevRequest = {
    model: MODEL,
    state:
      `transcript: ${input.transcript}\n` +
      `diff: ${input.diffSummary.slice(0, 2000)}`,
    questions: {
      matches: {
        type: "noul",
        instructions:
          "The applied diff implements what the speaker asked, completely and without unrelated or destructive changes.",
      },
    },
  };
  const transport =
    options.transport ?? defaultTransport(apiKey, options.endpoint ?? ENDPOINT);
  const timeoutMs = options.timeoutMs ?? POLICY.DECISION_TIMEOUT_MS;
  try {
    const raw = await withJevTimeout(
      (signal) => transport(request, signal),
      timeoutMs,
      `jev-verify timeout after ${timeoutMs}ms`,
    );
    const answers =
      typeof raw === "object" && raw !== null
        ? ((raw as { answers?: unknown }).answers as JevAnswers | undefined)
        : undefined;
    if (!answers || typeof answers !== "object") return pass;
    return { matches: clamp01(noul(answers, "matches"), 1) };
  } catch (err) {
    options.logger?.warn(
      "[jev-verify] passing open:",
      err instanceof Error ? err.message : err,
    );
    return pass;
  }
}
