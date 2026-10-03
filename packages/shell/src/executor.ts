// Dev C: edit executor — the truth boundary.
// Accepts Dev B's EditRequest, applies in the worktree, runs the build/lint
// gate, pre-commits, returns a truthful EditResult. Enforces the grill-locked
// retry cap (MAX_RETRIES=3 error-fed, then revert + fail).

import { POLICY } from "../../contracts/src/decision";
import type { EditRequest, EditResult } from "../../contracts/src/agent";
import type { IpcResult } from "../../contracts/src/ipc";
import { applyTier1Edit } from "./tier1";
import type { FileGitService } from "./git";

export interface BuildGate {
  check(filesChanged: string[]): Promise<{ ok: true } | { ok: false; message: string }>;
}

export const PASS_GATE: BuildGate = {
  check: () => Promise.resolve({ ok: true }),
};

export interface ExecutorDeps {
  git: FileGitService;
  readFile: (absPath: string) => Promise<string>;
  writeFile: (absPath: string, text: string) => Promise<void>;
  resolveRoot: (filePath: string | null) => string;
  generateDiff?: (
    req: EditRequest,
    context: { parentSection: string | null; attempt: number; lastError: string | null },
  ) => Promise<string | null>;
  buildGate?: BuildGate;
  didReload?: () => boolean | Promise<boolean>;
  now?: () => number;
}

/** Enclosing layout context, derived from the target file text the executor
 *  already read: a window around the target's data-source marker, else the
 *  file head. Free model context for retries — no extra I/O, no wire growth.
 *  Cross-file parents ride EditRequest.references (Dev B populates). */
export function enclosingContext(
  fileText: string,
  filePath: string | null,
): string {
  const marker = filePath ? `data-source="${filePath}` : "";
  const idx = marker ? fileText.indexOf(marker) : -1;
  if (idx < 0) return fileText.slice(0, 2000);
  const start = Math.max(0, idx - 1000);
  return fileText.slice(start, start + 2000);
}

/** Pure helper so the cap is testable without I/O. */
export function shouldRetry(attempt: number): boolean {
  return attempt < POLICY.MAX_RETRIES;
}

function envelopeFail(message: string): IpcResult<EditResult> {
  return { ok: false, code: "build-failed", message };
}

export async function submitEdit(
  req: EditRequest,
  deps: ExecutorDeps,
): Promise<IpcResult<EditResult>> {
  const startMs = (deps.now ?? Date.now)();
  const gate = deps.buildGate ?? PASS_GATE;

  const targetPath = req.target.filePath;
  if (!targetPath) {
    return envelopeFail(`no filePath for target ${req.target.id}: routing to large/fail, not a wrong file`);
  }
  const abs = deps.resolveRoot(targetPath);

  let original: string;
  try {
    original = await deps.readFile(abs);
  } catch (err) {
    return envelopeFail(`cannot read ${targetPath}: ${err instanceof Error ? err.message : String(err)}`);
  }

  // §5.4b: enclosing context derived from text already read — content at
  // apply time, nothing extra on the wire.
  const parentSection: string | null = enclosingContext(original, targetPath);

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
        nextText = applyTier1Edit(original, req.op);
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        nextText = null;
      }
    } else if (deps.generateDiff) {
      const diff = await deps.generateDiff(req, { parentSection, attempt, lastError });
      if (diff !== null) {
        // Narrow-diff path: generator returns full replacement text for the
        // target file in this harness (unified-diff apply is Dev C+1 work).
        nextText = diff;
      } else {
        // Generator unusable: fall back to Tier-1 hint when one exists.
        if (req.op !== null) {
          try {
            nextText = applyTier1Edit(original, req.op);
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
      const reloaded = deps.didReload ? await deps.didReload() : false;
      const durationMs = (deps.now ?? Date.now)() - startMs;
      const value: EditResult = {
        id: req.id,
        status: "applied",
        filesChanged: [targetPath],
        commitSha: snap.sha,
        durationMs,
        hotReloaded: reloaded === true,
      };
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
