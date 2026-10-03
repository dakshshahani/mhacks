# Kickoff — Branch Plan (hour 0)

Keys: TYPESAFE (live, probe-tested), ElevenLabs (sponsor), Haiku-class LLM.
Contracts frozen at hour 3 — read `packages/contracts/` before writing code.
All branches work ONLY through `@mhacks/contracts` imports. Never import
another dev's source. Check out your branch, work there, PR into `main`
reviewed by Dev B (fast — approve semantics, don't nitpick).

Contracts check before every push: `pnpm --filter @mhacks/contracts check`

## Branches & first work

| Branch | Person | First 2 hours |
|---|---|---|
| `dev/orchestrator` | Dev B | Freeze contracts w/ mocks (mockAgent, mockJev) — the *only* hour-3 blocker |
| `dev/shell` | Dev C | Scaffold `apps/desktop` React app + channel stubs returning `IpcResult` not-ready envelopes |
| `dev/gaze` | Dev A | WebGazer probe in a plain HTML page — calibration + `GazeFrame`-shaped output, no shell needed |
| `dev/ui` | PM | Figma: glass tokens + pipeline-state screens; hand Dev B the token lists by hour 3 |

## Hour 3 gate

Contracts frozen. If your branch rejects a contract shape, shout NOW — after
hour 3 changes cost PR review + a rebase for everyone.

## Integration contract with mocks

Dev B's mocks get committed hour ≤3 to main. Everyone pulls *main* after
that, not their branch siblings' branches. Dev C's envelope stubs + B's
mocks = G1 demo at hour ~5.

Rules recap: `ELEMENT data-source` plugin by Dev A targets the template repo
only; the demo site is the generic editable template (import is cut from
demo). Undo circle = auto-apply + 5s window, 500ms dwell / click.
