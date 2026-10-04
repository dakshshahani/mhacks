// Dev C: Tier-1 patch renderer (executor-side, pure, no model access).
// Deterministic className/string edits for the sub-2s no-llm path.
// Vocabulary owned by Dev B (EditOp union in agent.ts); this switch must stay
// exhaustive with that union — adding an op means updating both together.

import type { EditOp, ElementCandidate } from "@mhacks/contracts";
import {
  COLOR_TOKENS,
  RADIUS_TOKENS,
  SPACING_TOKENS,
  ALIGN_TOKENS,
  WEIGHT_TOKENS,
  SIZE_TOKENS,
} from "@mhacks/contracts";

export const COLOR_CLASS: Record<string, string> = {
  brand: "bg-brand",
  muted: "bg-muted",
  accent: "bg-accent",
};

export const RADIUS_CLASS: Record<string, string> = {
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
  full: "rounded-full",
};

export const SPACING_CLASS: Record<string, string> = {
  tight: "p-2 gap-2",
  normal: "p-4 gap-4",
  loose: "p-8 gap-8",
};

export const ALIGN_CLASS: Record<string, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
  justify: "text-justify",
};

export const WEIGHT_CLASS: Record<string, string> = {
  normal: "font-normal",
  medium: "font-medium",
  bold: "font-bold",
};

export const SIZE_CLASS: Record<string, string> = {
  xs: "text-xs",
  sm: "text-sm",
  base: "text-base",
  lg: "text-lg",
  xl: "text-xl",
};

const RADIUS_VALUES = new Set<string>([...RADIUS_TOKENS]);
const SPACING_VALUES: Set<string> = new Set([
  "p-2",
  "p-4",
  "p-8",
  "gap-2",
  "gap-4",
  "gap-8",
]);
const ALIGN_VALUES = new Set<string>([...ALIGN_TOKENS]);
const COLOR_VALUES = new Set<string>([...COLOR_TOKENS]);
// Class names stripped when swapping (managed set plus the common sibling so
// weights never stack: font-bold on top of font-semibold would fight).
const WEIGHT_VALUES = new Set<string>(["font-normal", "font-medium", "font-semibold", "font-bold"]);
// Managed sizes plus the larger display rungs so swaps replace, not stack.
const SIZE_VALUES = new Set<string>([
  "text-xs",
  "text-sm",
  "text-base",
  "text-lg",
  "text-xl",
  "text-2xl",
  "text-3xl",
]);

/** Exhaustiveness guard: adding an op to the EditOp union without a case
 *  here is a COMPILE error (op isn't never), not a silent undefined return
 *  (noImplicitReturns is off, so a missing case would otherwise fall through
 *  and hand undefined to the file writer). */
function assertNever(op: never): never {
  throw new Error(`unhandled EditOp: ${JSON.stringify(op)}`);
}

/** True when op/param is executable without a model (closure check mirror). */
export function isTier1Executable(op: string | null, param: string | null): boolean {
  if (op === "hide") return true;
  if (op === "swap-text") return typeof param === "string" && param.length > 0;
  if (op === "set-color") return typeof param === "string" && COLOR_VALUES.has(param);
  if (op === "set-radius") return typeof param === "string" && RADIUS_VALUES.has(param);
  if (op === "set-spacing")
    return typeof param === "string" && (SPACING_TOKENS as readonly string[]).includes(param);
  if (op === "set-align") return typeof param === "string" && ALIGN_VALUES.has(param);
  if (op === "set-weight")
    return typeof param === "string" && (WEIGHT_TOKENS as readonly string[]).includes(param);
  if (op === "set-size")
    return typeof param === "string" && (SIZE_TOKENS as readonly string[]).includes(param);
  return false;
}

function swapClassToken(classList: string, next: string, group: Set<string>): string {
  const parts = classList.split(/\s+/).filter((p) => p.length > 0 && !group.has(p));
  parts.push(next);
  return parts.join(" ");
}

function swapClassGroup(classList: string, next: string[], group: Set<string>): string {
  const parts = classList.split(/\s+/).filter((p) => p.length > 0 && !group.has(p));
  parts.push(...next);
  return parts.join(" ");
}

/**
 * Apply one Tier-1 op to file text. Scoped to the target element's
 * data-source line when known (multi-element files: the button's blue must
 * not land on the hero div); falls back to the first class/className
 * attribute when the target carries no line. swap-text replaces the inner
 * text run in scope; hide adds `hidden`. Pure string edit — no DOM, no
 * model, no network.
 */
export function applyTier1Edit(
  fileText: string,
  op: EditOp,
  target?: Pick<ElementCandidate, "sourceLine"> | null,
): string {
  const line = target?.sourceLine ?? null;
  switch (op.op) {
    case "set-color": {
      const next = COLOR_CLASS[op.param] ?? `bg-${op.param}`;
      return upsertClass(fileText, line, (cls) =>
        swapClassToken(cls, next, new Set(Object.values(COLOR_CLASS))),
      );
    }
    case "set-radius": {
      const next = RADIUS_CLASS[op.param] ?? `rounded-${op.param}`;
      return upsertClass(fileText, line, (cls) =>
        swapClassToken(
          cls,
          next,
          new Set([...Object.values(RADIUS_CLASS), "rounded", "rounded-none"]),
        ),
      );
    }
    case "set-spacing": {
      const next = (SPACING_CLASS[op.param] ?? "").split(" ").filter(Boolean);
      return upsertClass(fileText, line, (cls) => swapClassGroup(cls, next, SPACING_VALUES));
    }
    case "set-align": {
      const next = ALIGN_CLASS[op.param] ?? `text-${op.param}`;
      return upsertClass(fileText, line, (cls) =>
        swapClassToken(cls, next, new Set(Object.values(ALIGN_CLASS))),
      );
    }
    case "set-weight": {
      const next = WEIGHT_CLASS[op.param] ?? `font-${op.param}`;
      return upsertClass(fileText, line, (cls) => swapClassToken(cls, next, WEIGHT_VALUES));
    }
    case "set-size": {
      const next = SIZE_CLASS[op.param] ?? `text-${op.param}`;
      return upsertClass(fileText, line, (cls) => swapClassToken(cls, next, SIZE_VALUES));
    }
    case "hide": {
      return upsertClass(fileText, line, (cls) => {
        if (/\bhidden\b/.test(cls)) return cls;
        return cls.length > 0 ? `${cls} hidden` : "hidden";
      });
    }
    case "swap-text": {
      return replaceText(fileText, line, `>${escapeHtml(op.param)}<`);
    }
    default:
      return assertNever(op);
  }
}

/** Operate on one 1-based line when valid, else the whole text (legacy
 *  single-element behavior). Out-of-range lines fall back the same way —
 *  never a no-op throw on the sub-2s path. */
function scopeToLine(fileText: string, line: number | null): { head: string; scope: string; tail: string } {
  if (typeof line !== "number" || !Number.isInteger(line) || line < 1) {
    return { head: "", scope: fileText, tail: "" };
  }
  const lines = fileText.split("\n");
  if (line > lines.length) return { head: "", scope: fileText, tail: "" };
  const idx = line - 1;
  return {
    head: lines.slice(0, idx).join("\n") + (idx > 0 ? "\n" : ""),
    scope: lines[idx] as string,
    tail: (idx + 1 < lines.length ? "\n" : "") + lines.slice(idx + 1).join("\n"),
  };
}

function upsertClass(
  fileText: string,
  line: number | null,
  fn: (cls: string) => string,
): string {
  const { head, scope, tail } = scopeToLine(fileText, line);
  const re = /(className|class)="([^"]*)"/;
  const m = re.exec(scope);
  if (!m) {
    // No class attribute in scope: attach to the first opening tag there.
    const next = scope.replace(/<([a-zA-Z][\w-]*)/, (full, tag: string) => {
      const added = fn("");
      return `<${String(tag)} className="${added}"`;
    });
    return head + next + tail;
  }
  const current = m[2] ?? "";
  const next = fn(current);
  return head + scope.slice(0, m.index) + `${m[1]}="${next}"` + scope.slice(m.index + m[0].length) + tail;
}

function replaceText(fileText: string, line: number | null, replacement: string): string {
  const { head, scope, tail } = scopeToLine(fileText, line);
  // Single-line scope keeps multi-element files honest; the unscoped legacy
  // shape spans newlines, so a scoped regex without the multiline flag can
  // never leak onto a sibling element.
  const next = scope.replace(/>([^<>]{1,500})</, replacement);
  return head + next + tail;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
