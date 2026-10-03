# mhacks — AGENTS.md

Look → speak → code changes. A desktop app where an agent maker points at a UI
element with their eyes, says what they want, and an editing agent applies the
change to real source files — auto-applied, with a gaze-at-the-undo-circle
mechanic. Locked interview decisions: `docs/grill-decisions.md` (overrides the
PRD where they conflict).

> **Read before editing anything.** This file defines the architecture, the
> ownership seams, and the contracts. Disagreements with reality should be
> resolved by a PR to this file, not by drifting from it silently.

---

## 1. Product in one line

*Cursor, but you point with your eyes and direct with your voice.*

## 2. Core architectural decision (do not relitigate)

**Two-model design.** Jev (TypeSafe AI, the System One decision model) decides;
an LLM edits. Jev is *not* a chat model. It cannot generate text or code. It
returns typed values over options **we enumerate for it**:

- `choice` — one of up to our-instrumented criteria (we use ≤5 elements,
  ≤255 supported cardinality)
- `score` — a 2–10 ordered scale (we use 0–1 normalized scores)
- `noul` — a calibrated yes/no probability

Everything user-facing (status lines, confirm prompts) is written by our code.
Jev output is never shown as prose.

**Roles of the two models:**

| Decision | Who | Notes |
| --- | --- | --- |
| Intent classification | Jev `choice` | style/layout/content/add/delete/other |
| Gaze disambiguation | Jev `choice` | among 2–5 candidate elements |
| Actionability gate | Jev `noul` | drops background chatter |
| Apply policy | Jev `score` | risk widens the 5s undo-window; never a Confirm dialog |
| Route | Jev `choice` | no-llm / small / large — token spend control |
| Verify | Jev `noul` | does the diff match the ask; one retry max |

**Why Jev at all:** ~70–500ms, ~$0.001/decision, no prose to parse. Enables
running on *every* utterance instead of only on obvious commands.

## 3. Sub-2-second rule (design law)

Round-trip from final speech token to **changed pixels on screen** under
~2s for the demo's happy path. Enforced by routing:

| Route | Path | Budget |
| --- | --- | --- |
| no-llm | Jev decides → our code emits a `EditOp` patch → file write → HMR | ~1s |
| small | Small fast model, narrow diff (path & component already resolved) | 300–800ms |
| large | Frontier model + agent loop + build check | 3–10s, only used for a couple of demo-worthy semantic edits |

Sub-2s budget breakdown: speech finalization ≤1.5s · Jev ≤0.5s · small-LLM
≤0.8s · build gate only on `large` · Jev-verify skipped on no-llm (build +
Undo covers it).

**Key device:** the *closure* of the no-llm route. Jev only picks from
catalogs we build at call time from live state:

```
target × op × param → deterministic patch function
"hero" + set-color + brand → hero className += `bg-[--color-brand]`
```

If closure fails (`inCatalog < AUTOMATION_MIN`), route to LLM. Never force
a Jev choice when the true intent isn't in the catalog.

## 4. Repo layout

```
mhacks/
├── AGENTS.md                  ← this file
├── docs/
│   └── design/
│       └── app-states.excalidraw     ← source of truth for UI states
├── packages/
│   └── contracts/             ← ONLY cross-team interface artifact
│       └── src/
│           ├── gaze.ts             Dev A produces → Dev B / UI consume
│           ├── agent.ts            Dev B produces → Dev C executes
│           ├── decision.ts         Dev B owns (DecisionLayer, POLICY)
│           ├── ipc.ts              Dev C implements channels
│           └── mocks/              mockAgent, mockJev — deterministic stubs
└── apps/
    └── desktop/               Electron + React + Tailwind (P0 shell)
        └── src/
            ├── main/          Dev C: webview lifecycle, IPC res, git svc
            └── renderer/      Dev A (gaze client) + PM/UI (overlay & states)
```

Only `packages/contracts/` is a shared mutable artifact. Changes land only as
PRs reviewed by Dev B. Every other package imports from contracts, never
another dev's source tree.

## 5. Ownership seams (features must not be assigned outside these)

| Seam | Owner | Deliverable | Never owns |
| --- | --- | --- | --- |
| Gaze client (webview side) | Dev A | `(x, y) ⇒ Promise<GazeFrame>`, works in any webview | overlay rendering, agent, files |
| Orchestrator | Dev B | contracts/, DecisionLayer (Jev), CodeAgent, pipeline state machine | speaking, mic, git internals |
| Shell & side effects | Dev C | IPC res side, git service, dev-server manager, BYOK via safeStorage | deciding *what* goes in an EditRequest |
| UI | PM | glass design system, per-state screens, overlays, timeline, speech toggle | business logic, allocations |

**Pipeline state machine is Dev B's:** `idle → listening → locked → editing →
verifying → applied | failed` (see `PipelineStage`). Others emit typed events
into it, never mutate it.

## 6. Contract rules

1. **Stable identifiers.** `ElementCandidate.id` is the join key inside a
   `GazeFrame`; use it, never silent `selector` matching.
2. **JSON-safe across boundaries.** No functions, Maps, DOMRects over
   webview/IPC. `boundingRect` is `JSONRect`.
3. **Errors are envelopes.** Every Invoke-style channel returns
   `IpcResult<T>` (`{ok: true, value}` / `{ok: false, code, message}`). No
   null-by-convention error handling.
4. **Calibration-first.** Jev's confidence is a *margin*, not P(correct) and
   Jev is prompt-injectable — never let untrusted web content flow into a
   `DecisionInput` field that maps to an action.
5. **Determinism over cleverness.** Option ordering in criteria is part of
   Jev's input — never shuffle.

## 7. Policy is code, not prompts

`POLICY` in `contracts/src/decision.ts` is the single source of truth for
thresholds (`AUTOMATION_MIN`, `ACTIONABLE_MIN`, `RETRY_THRESHOLD`,
`APPLY_THRESHOLD`, `MAX_RETRIES`…). Build-gate retries cap at `MAX_RETRIES`
(3, grill-locked: error-fed, then revert + fail card); verify retries once.
Tuning these requires a PR that notes the probe run (`npm run probe` on
`jev-end`-style harness) that informed it.

**Git-as-buttons UI mapping:**

| Button | Meaning | Implementation path |
| --- | --- | --- |
| Confirm | commit one edit | `git:confirm` on the pre-commit `sha` (power path; demo path is the undo circle) |
| New Version | branch for a bigger change | `git:createSnapshot` |
| Undo | revert last edit | `git:undo` — triggered by ~500ms gaze dwell or click on the undo circle during the 5s window |
| Version history | timestamps of edits | `git:history` |

Worktrees + branches isolate every edit. Build-gate everything before
showing diffs to users (may only be skipped on `no-llm` route patches which
are class-only string edits).

## 8. Demo quality bar

- Look→speak→change→undo ×3 in a row without manual intervention
- ≥80% gaze-highlight correctness on demo project
- Sub-2s round-trip on catalog edits (≈70–80% of the scripted demo)
- A judge without git knowledge can undo a change

If any feature threatens these, drop to a lower priority tier — the demo is
the success criterion.

## 9. Risks (living list)

| Risk | Mitigation | Owner |
| --- | --- | --- |
| Webcam gaze jitter | dwell + smoothing + snap + click fallback | Dev A |
| DOM→source mapping fails on foreign repos | data-source attributes at dev time; template repo only | Dev B |
| LLM edits break the build | worktree + build gate + one-click undo | Dev C |
| Speech misrecognition | transcript shown/editable before apply | PM/UI |
| Jev unavailable/wrong decisions | `DecisionLayer` interface + LLM stub + probe harness | Dev B |
| Prompt-injection flipping gates | untrusted content excluded from DecisionInput | Dev B |
| Wi-Fi / camera failure demo day | pre-recorded video, local fallback | PM |

## 10. Definition of done (for any contract PR)

- [ ] types only, or pure functions with no I/O
- [ ] referenced types only from sibling contract files, never ad-hoc shapes
- [ ] envelope-shaped `res` for may-fail channels
- [ ] `tsc --noEmit` passes with `strict`
- [ ] mock updated to satisfy the new shape
- [ ] this AGENTS.md updated if semantics changed
