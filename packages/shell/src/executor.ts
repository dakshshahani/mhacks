// Dev C: edit executor — the truth boundary.
// Accepts Dev B's EditRequest, applies in the worktree, runs the build/lint
// gate, pre-commits, returns a truthful EditResult. Enforces the grill-locked
// retry cap (MAX_RETRIES=3 error-fed, then revert + fail).

import { POLICY } from "@mhacks/contracts";
import type {
  EditRequest,
  EditResult,
  ParentAddress,
} from "@mhacks/contracts";
import type { IpcResult } from "@mhacks/contracts";
import { applyTier1Edit } from "./tier1";
import type { FileGitService } from "./git";

export interface BuildGate {
  check(filesChanged: string[]): Promise<{ ok: true } | { ok: false; message: string }>;
}

export const PASS_GATE: BuildGate = {
  check: () => Promise.resolve({ ok: true }),
};

/** EditRequest.parent is now a contract field (agent.ts); this alias stays
 *  for call sites that name the extended shape explicitly. */
export type EditRequestWithParent = EditRequest;

export interface ExecutorDeps {
  git: FileGitService;
  readFile: (absPath: string) => Promise<string>;
  writeFile: (absPath: string, text: string) => Promise<void>;
  resolveRoot: (filePath: string | null) => string;
  readParentSection?: (address: ParentAddress) => Promise<string | null>;
  generateDiff?: (
    req: EditRequest,
    context: {
      parentSection: string | null;
      /** Full current text of the target file. The generator must return
       *  complete replacement file content (never a unified diff — applying
       *  diffs is Dev C+1 work); without this the model can only guess. */
      currentText: string;
      attempt: number;
      lastError: string | null;
    },
  ) => Promise<string | null>;
  buildGate?: BuildGate;
  didReload?: () => boolean | Promise<boolean>;
  now?: () => number;
}

/** Pure helper so the cap is testable without I/O. */
export function shouldRetry(attempt: number): boolean {
  return attempt < POLICY.MAX_RETRIES;
}

function envelopeFail(message: string): IpcResult<EditResult> {
  return { ok: false, code: "build-failed", message };
}

export async function submitEdit(
  raw: EditRequest,
  deps: ExecutorDeps,
): Promise<IpcResult<EditResult>> {
  const req = raw as EditRequestWithParent;
  const t0 = (deps.now ?? Date.now)();
  const gate = deps.buildGate ?? PASS_GATE;

  const targetPath = req.target.filePath;
  if (!targetPath) {
    return envelopeFail(`no filePath for target ${req.target.id}: routing to large/fail, not a wrong file`);
  }
  // Containment: filePath originates in page content (data-source attrs are
  // web content, hence untrusted) — it must name a file inside the project
  // root, never an absolute path or a parent escape. resolveRoot joins, so
  // `..` segments would break out silently without this gate.
  if (
    targetPath.includes("\0") ||
    targetPath.startsWith("/") ||
    /(^|\/)\.\.(\/|$)/.test(targetPath)
  ) {
    return envelopeFail(`refusing suspicious filePath for target ${req.target.id}: not inside the project root`);
  }
  const abs = deps.resolveRoot(targetPath);

  let original: string;
  try {
    original = await deps.readFile(abs);
  } catch (err) {
    return envelopeFail(`cannot read ${targetPath}: ${err instanceof Error ? err.message : String(err)}`);
  }

  // §5.4b: resolve parent address at apply time (content at apply, address on wire).
  let parentSection: string | null = null;
  const parent = req.parent;
  if (parent && parent.filePath && deps.readParentSection) {
    try {
      parentSection = await deps.readParentSection(parent);
    } catch {
      parentSection = null;
    }
  }

  // Baseline so Undo always has somewhere to go: capture pre-edit state
  // before mutating. Post-edit pre-commit below is the second half.
  try {
    await deps.git.createSnapshot(`pre-edit ${req.id}`);
  } catch {
    // Snapshot failure never blocks the edit itself.
  }

  let lastError: string | null = null;
  for (let attempt = 0; attempt <= POLICY.MAX_RETRIES; attempt++) {
    let nextText: string | null = null;

    if (req.op !== null && (req.route === "no-llm" || !deps.generateDiff)) {
      // Tier-1 deterministic path (sub-2s). No model, no network.
      try {
        nextText = applyTier1Edit(original, req.op, req.target);
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        nextText = null;
      }
    } else if (deps.generateDiff) {
      const diff = await deps.generateDiff(req, {
        parentSection,
        currentText: original,
        attempt,
        lastError,
      });
      if (diff !== null) {
        // Narrow-diff path: generator returns full replacement file content
        // in this harness (unified-diff apply is Dev C+1 work).
        // Truncation guard: a model cut off by maxOutputTokens returns a
        // VALID-LOOKING prefix (balanced so far, markers intact) that would
        // silently drop half the file. Small edits preserve length; only a
        // delete intent may legitimately shrink below half.
        if (diff.length < original.length * 0.5 && req.intent !== "delete") {
          lastError =
            `generated file suspiciously short (${diff.length} vs ${original.length} chars` +
            ` — possible output truncation); regenerate the COMPLETE file`;
          nextText = null;
        } else if (diff === original) {
          // A generated diff that changes nothing is a model miss, not an
          // apply (Tier-1 keeps its idempotent no-ops; the model path must
          // move pixels). Error-fed retry gives it one guided second chance.
          lastError =
            "generated file is identical to the current file: the requested change is not in it; " +
            "re-read the target element and apply the edit";
          nextText = null;
        } else {
          nextText = diff;
        }
      } else {
        // Generator unusable: fall back to Tier-1 hint when one exists.
        if (req.op !== null) {
          try {
            nextText = applyTier1Edit(original, req.op, req.target);
          } catch (err) {
            lastError = err instanceof Error ? err.message : String(err);
            nextText = null;
          }
        } else {
          lastError = lastError ?? "diff generator returned null";
        }
      }
    } else {
      lastError = "no-llm op missing and no diff generator";
    }

    if (nextText === null) {
      if (attempt < POLICY.MAX_RETRIES) continue;
      return envelopeFail(`retry-exhausted after ${attempt + 1} attempt(s): ${lastError ?? "unknown"}`);
    }

    try {
      await deps.writeFile(abs, nextText);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < POLICY.MAX_RETRIES) continue;
      return envelopeFail(`retry-exhausted: write failed: ${lastError}`);
    }

    const gateRes = await gate.check([targetPath]);
    if (gateRes.ok) {
      const snap = await deps.git.createSnapshot(`edit ${req.id}`);
      const hot = deps.didReload ? await deps.didReload() : false;
      const durationMs = (deps.now ?? Date.now)() - t0;
      const value: EditResult = {
        id: req.id,
        status: "applied",
        filesChanged: [targetPath],
        commitSha: snap.sha,
        durationMs,
        hotReloaded: hot === true,
      };
      if (nextText.length > 0) value.diffExcerpt = nextText.slice(0, 800);
      return { ok: true, value };
    }

    // Build failed: revert this attempt, append error context, retry per cap.
    lastError = gateRes.message;
    try {
      await deps.writeFile(abs, original);
    } catch {
      // Best-effort revert; fall through to retry/fail.
    }
    if (attempt >= POLICY.MAX_RETRIES) {
      return envelopeFail(`retry-exhausted after ${attempt + 1} attempt(s): ${lastError}`);
    }
    // Loop: next attempt carries lastError as retry context.
  }
  return envelopeFail(`retry-exhausted: ${lastError ?? "unknown"}`);
}
