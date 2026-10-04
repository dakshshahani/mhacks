// Demo decide-and-edit (phase 2: the harness /api/decide-and-edit demo
// branch, moved into main). Returns HTTP-shaped {status, body} so the shared
// renderer transport needs no shell-specific response handling.
//
// Mutual exclusion is transport-owned (counter claimed synchronously — no
// await between check and claim, so racing sends can't both enter).

import { decideAndEdit } from "../decide";
import type { DemoServices } from "./services";

export interface DecideBody {
  transcript?: unknown;
  x?: unknown;
  y?: unknown;
  frame?: unknown;
}

export function createDecideHandler(svc: DemoServices) {
  let decideActive = 0;

  return async function handleDecide(body: DecideBody): Promise<{ status: number; body: unknown }> {
    const transcript = typeof body.transcript === "string" ? body.transcript : "";
    const x = Number(body.x);
    const y = Number(body.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { status: 400, body: { ok: false, code: "unknown", message: "x/y must be numbers" } };
    }
    const st = svc.pipeline.getState().stage;
    if (decideActive > 0 || st === "locked" || st === "editing" || st === "verifying") {
      return {
        status: 409,
        body: {
          ok: false,
          code: "unknown",
          message: `pipeline is ${decideActive > 0 ? "busy" : st}; wait for applied/failed`,
        },
      };
    }
    decideActive += 1;
    const t0 = Date.now();
    try {
      const liveFrame = svc.sanitizeFrame(body.frame);
      // Same foreign-frame guard as the harness demo branch (this handler is
      // demo-scoped): zero mapped filePaths means the finder never ran.
      if (
        liveFrame &&
        liveFrame.candidates.length > 0 &&
        !liveFrame.candidates.some((c) => typeof c.filePath === "string" && c.filePath.length > 0)
      ) {
        console.log(`[pipeline] demo pipeline got a foreign frame (${liveFrame.candidates.length} candidates, none mapped)`);
        return {
          status: 422,
          body: {
            ok: false,
            code: "unknown",
            message: "this looks like a project page, not the demo — open the project from the gallery so its files can be mapped, then edit there",
          },
        };
      }
      const outcome = await decideAndEdit(transcript, x, y, {
        decide: svc.decide,
        submitEdit: svc.submitEdit,
        verify: svc.verify,
        pipeline: svc.pipeline,
        speech: svc.speech,
        queryFrame: async (qx, qy) => {
          if (liveFrame && liveFrame.candidates.length > 0) return liveFrame;
          return svc.queryFrame(qx, qy);
        },
      });
      switch (outcome.kind) {
        case "applied": {
          const d = outcome.decision;
          console.log(
            `[pipeline] applied in ${Date.now() - t0}ms route=${d.route} intent=${d.intent} op=${JSON.stringify(d.op)} verified=${outcome.verified} sha=${outcome.editResult.commitSha.slice(0, 8)}`,
          );
          return {
            status: 200,
            body: {
              ok: true,
              decision: outcome.decision,
              editRequest: outcome.editRequest,
              editResult: outcome.editResult,
              undoWindowMs: outcome.undoWindowMs,
              verified: outcome.verified,
            },
          };
        }
        case "dropped":
          return { status: 200, body: { ok: true, dropped: true, decision: outcome.decision } };
        case "busy":
          return { status: 409, body: { ok: false, code: "unknown", message: outcome.message } };
        case "error":
          console.log(`[pipeline] error after ${Date.now() - t0}ms: ${outcome.message}`);
          return { status: 422, body: { ok: false, code: "build-failed", message: outcome.message } };
      }
    } catch (err) {
      const code = err && typeof (err as { code?: unknown }).code === "number"
        ? (err as { code: number }).code
        : 500;
      return {
        status: code,
        body: {
          ok: false,
          code: code === 503 ? "not-ready" : "unknown",
          message: err instanceof Error ? err.message : String(err),
        },
      };
    } finally {
      decideActive -= 1;
    }
  };
}
