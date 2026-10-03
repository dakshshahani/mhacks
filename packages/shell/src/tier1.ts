// Dev C: Tier-1 patch renderer (executor-side, pure, no model access).
// Deterministic className/string edits for the sub-2s no-llm path.
// Vocabulary owned by Dev B (EditOp union in agent.ts); this switch must stay
// exhaustive with that union — adding an op means updating both together.

import type { EditOp } from "../../contracts/src/agent";
import {
  COLOR_TOKENS,
  RADIUS_TOKENS,
  SPACING_TOKENS,
  ALIGN_TOKENS,
} from "../../contracts/src/agent";

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

const RADIUS_VALUES = new Set<string>([...RADIUS_TOKENS]);
const SPACING_VALUES = new Set<string>(SPACING_CLASS_SPACING_VALUES());
const ALIGN_VALUES = new Set<string>([...ALIGN_TOKENS]);
const COLOR_VALUES = new Set<string>([...COLOR_TOKENS]);

function SPACING_CLASS_SPACING_VALUES(): string[] {
  return ["p-2", "p-4", "p-8", "gap-2", "gap-4", "gap-8"];
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
 * Apply one Tier-1 op to file text. Operates on the first class/className
 * attribute found (template components each own one); appends when absent.
 * swap-text replaces the first inner-text run (>...<); hide adds `hidden`.
 * Pure string edit — no DOM, no model, no network.
 */
export function applyTier1Edit(fileText: string, op: EditOp): string {
  switch (op.op) {
    case "set-color": {
      const next = COLOR_CLASS[op.param] ?? `bg-${op.param}`;
      return upsertClass(fileText, (cls) =>
        swapClassToken(cls, next, new Set(Object.values(COLOR_CLASS))),
      );
    }
    case "set-radius": {
      const next = RADIUS_CLASS[op.param] ?? `rounded-${op.param}`;
      return upsertClass(fileText, (cls) =>
        swapClassToken(
          cls,
          next,
          new Set([...Object.values(RADIUS_CLASS), "rounded", "rounded-none"]),
        ),
      );
    }
    case "set-spacing": {
      const next = (SPACING_CLASS[op.param] ?? "").split(" ").filter(Boolean);
      return upsertClass(fileText, (cls) => swapClassGroup(cls, next, SPACING_VALUES));
    }
    case "set-align": {
      const next = ALIGN_CLASS[op.param] ?? `text-${op.param}`;
      return upsertClass(fileText, (cls) =>
        swapClassToken(cls, next, new Set(Object.values(ALIGN_CLASS))),
      );
    }
    case "hide": {
      return upsertClass(fileText, (cls) => {
        if (/\bhidden\b/.test(cls)) return cls;
        return cls.length > 0 ? `${cls} hidden` : "hidden";
      });
    }
    case "swap-text": {
      return fileText.replace(/>([^<>]{1,500})</, `>${escapeHtml(op.param)}<`);
    }
  }
}

function upsertClass(fileText: string, fn: (cls: string) => string): string {
  const re = /(className|class)="([^"]*)"/;
  const m = re.exec(fileText);
  if (!m) {
    // No class attribute: attach to the first opening tag so the edit lands.
    return fileText.replace(/<([a-zA-Z][\w-]*)/, (full, tag: string) => {
      const added = fn("");
      return `<${String(tag)} className="${added}"`;
    });
  }
  const current = m[2] ?? "";
  const next = fn(current);
  return fileText.slice(0, m.index) + `${m[1]}="${next}"` + fileText.slice(m.index + m[0].length);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
