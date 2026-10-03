# Dev C — Shell & Side Effects (the real world)

> Branch: `dev/shell` · Load: ~25% · Features: F1, F4 (plumbing), F6, F5-exec side
> Sources of truth: `AGENTS.md §5,7` (seams, git-as-buttons), `docs/PRD.md §7`
> (preview, speech, git), `docs/grill-decisions.md` (overrides PRD),
> `docs/team-plan.md` (Dev C), `docs/kickoff.md`.
> Contracts: `packages/contracts/src/ipc.ts`, `agent.ts` (EditRequest/Result), `gaze.ts`.

## 1. Mission in one sentence

Own everything that touches the real world — app shell + embedded preview,
all IPC channels, git worktrees, the edit executor + Tier-1 patch renderer,
dev-server manager, and ALL speech plumbing (STT command capture + TTS
narration) — so Dev A has somewhere to probe and Dev B has somewhere to apply.

You decide **how** an edit lands. You never decide **what** the edit is
(that is Dev B's `EditRequest`).

## 2. Ownership seam (hard boundary)

| You own | You never own |
|---|---|
| App shell + embedded preview running managed dev server (F1) | Deciding what goes in an `EditRequest` (Dev B) |
| ALL `ipc.ts` channels, res side, `IpcResult` envelopes | Intent / target / route decisions |
| Git service: worktree + branch + undo + history + confirm | Overlay rendering, screens (PM) |
| Edit executor: apply in worktree, build/lint gate, pre-commit | Gaze probing logic (Dev A — you just host the webview it runs in) |
| **Tier-1 patch renderer** (`EditOp` → deterministic edit, executor-side) | Token catalog vocabulary (Dev B defines; you implement exhaustively) |
| Dev-server manager: spawn/restart/HMR detection | Business logic behind states |
| Speech plumbing STT (P0) + TTS (P2) behind same `speech:*` channels | Transcript interpretation (Dev B) |
| `safeStorage` BYOK wrapper (~20 lines, after G3, only if time) | Pricing/billing (mocked; PM owns UI) |
| Electron wrap — LAST, only after G3 | — |

## 3. Grill decisions that constrain you (do not relitigate)

1. **React-first shell.** `apps/desktop` is scaffolded as React. Electron
   main-process code hides behind `ipc.ts` so the wrap is additive, not a
   rewrite. **If Electron isn't DONE by G3, the demo runs in the browser
   harness.** The browser harness ships — no heroics night-before.
2. **Auto-apply every edit. No Confirm dialogs.** A 5s undo circle appears;
   ~500ms gaze dwell (Dev A) or click reverts via `git:undo`. Risk widens the
   window (Dev B's `riskScore`), never gates a dialog. `git:confirm` survives
   only as the power-path commit on the pre-commit sha.
3. **Speech engine: ElevenLabs sponsor for the demo** (PRD "no sponsor" header
   is void). STT = Web Speech primary / ElevenLabs Scribe fallback (P0);
   TTS = agent narration (P2, F14) behind the same `speech:*` channels.
   Mic chip must show the sponsor badge (disclosure rule — PM renders it,
   you emit the state that drives it).
4. **Tier-1 patch renderer is YOURS** (reassigned from Dev B in the final
   split). Pure deterministic code against frozen catalogs, no model access,
   executor-side. ~2h. The sub-2s path lives here.
5. **BYOK is display-only** (billing mocked — no Stripe, no webhooks).
   PM owns the key field UI; you add a ~20-line `safeStorage` wrapper
   sometime **after G3** only if time. Never before the core loop works.
6. **Import site/URL cut entirely from the demo.** Options stay in UI but route
   to "not yet" states. You do not implement import.
7. **Mocks are sanctioned stubs.** `mockAgent`/`mockJev` (Dev B, hour ≤3) +
   your envelope `not-ready` stubs = G1 demo at hour ~5. G3 is two small
   swaps (real agent ~h9, real Jev ~h11), not one three-way merge.
8. **Retry objection stands.** Unlimited-retries churns tokens and stalls the
   pipeline on stage. Your executor must enforce Dev B's cap (3 error-fed
   retries, then revert + "couldn't apply" card). Log it.

## 4. Contracts you implement (`ipc.ts` — you are the only writer, res side)

```ts
IpcResult<T> = {ok:true, value:T}
             | {ok:false, code:"not-ready"|"wv-gone"|"build-failed"|"unknown", message:string}

"preview:queryElementAt": { req:{x,y}, res: IpcResult<GazeFrame> }
  // Hosts Dev A's probe inside the webview. Webview gone → "wv-gone".
"preview:setCalibration": { req:{status}, res: IpcResult<undefined> }

"agent:submitEdit": { req: EditRequest, res: IpcResult<EditResult> }
  // Dev B → you. Apply in worktree, build-gate, pre-commit, return truth.
"pipeline:state": { event: PipelineState }  // Dev B emits; you transport; PM renders

"git:createSnapshot": { req:{label}, res: IpcResult<{sha}> }  // New Version
"git:undo":           { req: undefined, res: IpcResult<{sha}> } // Undo circle
"git:confirm":        { req:{sha}, res: IpcResult<{sha}> }      // power path only
"git:history":        { req: undefined, res: IpcResult<{sha,label,at}[]> }

"speech:start": { req: undefined, res: IpcResult<{streamId}> }
"speech:stop":  { req: undefined, res: IpcResult<undefined> }
"speech:transcript": { event: SpeechEvent }  // {text, isFinal}
"speech:state": { event: SpeechState }       // off|listening|processing
```

Rules: every invoke returns an envelope — never throw across IPC, never
null-by-convention. Payload types reference `gaze.ts`/`agent.ts`/`decision.ts`
types only, never ad-hoc shapes. Only serialized JSON crosses webview/IPC
(no functions, Maps, DOMRects).

Hour 3–4 deliverable: **every channel skeleton wired, returning `not-ready`
stubs.** That + Dev B's mocks = G1 readiness. Do not wait for real git to
unblock PM/Dev A.

## 5. Build order (integration order — follow it)

### 5.1 App shell + embedded preview (F1) — Hour 4, unblocks everyone

- React app in `apps/desktop` running the template project's dev server in an
  embedded preview (`<webview>`/BrowserView; browser-harness `<iframe>` counts
  for G1–G2).
- Managed dev server: spawn / restart / port-pick / log pipe. HMR detection is
  the source of `EditResult.hotReloaded` truth (see §7).
- Preview must expose a probe hook for `preview:queryElementAt` (runs Dev A's
  `queryElementAt` inside the webview context) and ignore PM's overlay layer
  (agree `[data-gaze-overlay]` exclusion with PM + Dev A once).
- Electron wrap comes LAST (§9). All of the above must work in the plain
  React/browser harness first.

### 5.2 IPC skeletons — Hour 3–4 (G1 readiness)

- Stub every channel in §4 with `not-ready` envelopes. G1 crossing test (hour
  ~5) is UI + `mockAgent` end-to-end **via your channels** — you own that risk.

### 5.3 Git service — standalone module first, channels second

- Implement as a standalone Node module first, tested by script against the
  template repo. Then wrap in `git:*` channels.
- Mapping (git-as-buttons, `AGENTS.md §7`):

| Button | Meaning | Implementation |
|---|---|---|
| Confirm | commit one edit (power path; demo path is the undo circle) | `git:confirm` on the pre-commit `sha` |
| New Version | branch for a bigger change | `git:createSnapshot` (worktree + branch) |
| Undo | revert last edit (~500ms gaze dwell or click, 5s window) | `git:undo` |
| Version history | timestamps of edits | `git:history` |

- Auto-commit a snapshot after each agent edit so Undo is always one click.
- Worktrees + branches isolate every edit. Build-gate everything before
  showing diffs (may only be skipped on `no-llm` class-only string edits).
- `git:history` returns `{sha, label, at}[]` — PM's version timeline renders
  from this (mocked first).

### 5.4 Edit executor — the truth boundary

- Accepts `EditRequest` from `agent:submitEdit`, applies **in the worktree**,
  runs the build/lint gate, pre-commits, returns a **truthful** `EditResult`
  (real `commitSha`, real `filesChanged`, real `hotReloaded`, real
  `durationMs`, honest `status`).
- Statuses: `"applied" | "build-failed" | "retry-exhausted"`. Build failure
  is an envelope (`code:"build-failed"`), never an exception across IPC.
- Enforces the retry cap (§3.8): error-fed retries ≤3 with build-error context
  appended, then revert to pre-edit state + fail card. User-invoked retry is
  the only unlimited path.
- G3 definition of done: real 3.5 Flash-Lite edit through Dev B's agent → real commit
  → undo works. The one-line mock→real swap is yours.

### 5.5 Tier-1 patch renderer — the sub-2s path (~2h, pure code)

- Input: `EditOp` union (Dev B's vocabulary) + `ElementCandidate.filePath`.
  Output: deterministic className/string edit. No model, no network.
- Exhaustive switch over the union — adding an op means updating this switch
  + the union together (coordinate with Dev B):

```
set-color {brand,muted,accent} → className += token class (must match PM tokens exactly)
set-radius {sm,md,lg,full}     → rounded-* class swap
set-spacing {tight,normal,loose} → padding/gap class swap
hide                        → hidden class / display:none
swap-text {string}          → textContent replace from transcript span
```

- Route `no-llm` ignores generated diffs; Jev-verify skipped (build + Undo
  covers it). Budget ~1s file-write→HMR. This carries 70–80% of the scripted demo.
- `COLOR_TOKENS` frozen hour 3 from PM — your renderer must match them exactly.

### 5.6 Speech plumbing — ALL speech is yours (STT P0 + TTS P2)

- Behind the same `speech:*` channels. Shell owns the mic stream; emits
  `speech:transcript {text, isFinal}` + `speech:state` events.
- **STT (P0, ~1h):** command capture. Web Speech primary, ElevenLabs Scribe
  fallback. States Off/Listening/Processing always visible (PM renders; you
  emit). `speech:start` on hotkey-toggle → `listening` (this is also Dev A's
  lock-on signal) → final token → `processing` → Dev B pipeline.
- **TTS (P2, F14):** agent narration. Deterministic template sentence from
  `EditResult` (e.g. `"Applied hero color."`), drop-cut is an `<audio>`
  element. **Must be tested by G4 or it doesn't ship.** First cut if the core
  loop slips.
- Transcript shown/editable before apply (misrecognition mitigation — PM UI,
  your events).

### 5.7 BYOK + Electron — both AFTER G3

- BYOK: PM owns the field; you add the ~20-line `safeStorage` wrapper after
  G3 only if time. Billing is mocked; there is no backend to call.
- Electron wrap: additive behind `ipc.ts`. If not DONE by G3, the browser
  harness ships (locked). Do not re-test the core loop in a new process model
  the night before the demo.

## 6. Hour-by-hour plan (24h clock)

| Hour | Do | Done looks like |
|---|---|---|
| 0–2 | Scaffold `apps/desktop` React app + channel stubs (`not-ready` envelopes). | `pnpm dev` shows shell + empty preview |
| 3–4 | Preview alive running template dev server; G1 readiness (all stubs wired). Pull Dev B's mocks from `main` (never sibling branches). | PM demos mock flow end-to-end (G1 ~h5, you own the risk) |
| 5–8 | Git service as standalone module, tested by script (snapshot/undo/history on template); executor skeleton accepting `EditRequest`. Real gaze + real speech → mock edit (G2 ~h8). | `git:undo` reverts a scripted edit; mock edit lands in real DOM |
| 8–10 (G3) | Real edit lands: Dev B's real agent → your executor → real commit → undo works. Two small swaps (agent ~h9, Jev ~h11). | One-line mock→real swap; your DoD |
| 10–14 | Tier-1 renderer + HMR truth + STT fallback hardened; sub-2s measured on catalog edits. | 70–80% of demo script on `no-llm` path |
| 14–17 (G4) | Failure paths exercised: build-failed envelope, undo inside window, webview not-ready, TTS tested or cut. | Full real pipeline incl. undo circle + mocked tiers |
| 17–21 (G5) | Freeze + outsider test support; Electron only if G3 passed. | Unassisted look→speak→change→undo |

Gate rule: feature missing its gate drops to P1 immediately. Order of cuts:
Electron → TTS → landing-vibecode → `large` route. Never the core loop.

## 7. Dev-server manager (source of `hotReloaded` truth)

- Spawn/restart the template dev server, pick a free port, pipe logs,
  detect HMR reload after each edit (file-watch or dev-server event).
- `EditResult.hotReloaded` is true only when HMR actually picked it up —
  never optimistic. PM's "applied" screen + token meter depend on it.
- Kill cleanly on shell close; restart on crash with the pre-edit worktree
  intact (undo must survive a server restart).

## 8. Testing checklist (failure paths are G4 — rehearse them)

- [ ] All channels return envelopes; unknown webview → `wv-gone`, cold start → `not-ready`.
- [ ] Git script: snapshot → edit → undo → history lists timestamped sha. Undo after restart still works.
- [ ] Executor: valid `EditRequest` → real `commitSha` + `filesChanged`; broken edit → `build-failed` envelope + fail card, worktree reverted.
- [ ] Tier-1: each `EditOp` on each demo element → correct class/text change + HMR <1s.
- [ ] Preview probe: `preview:queryElementAt` returns Dev A's `GazeFrame` in webview AND browser harness.
- [ ] Speech: hotkey toggles `listening`; final transcript emits once; Scribe fallback works with mic blocked.
- [ ] TTS (if kept): `<audio>` plays the template sentence per edit; tested by G4 or deleted.
- [ ] Undo inside 5s window reverts; undo after window is a no-op with a clean message.
- [ ] Camera/mic-off full demo via click override only (Dev A's fallback, your channels carry it).

## 9. Why Electron is last (read before arguing)

Wrapping React in a window is 15 minutes. The shell's real work is process
model + OS integration + distribution: webview preload isolation, IPC
lifecycle, dev-server + git binaries in the packaged app, camera/mic
entitlements, DMG signing/notarization. Each breaks "works on my laptop" in
a new way, and fixing them the night before the demo means re-testing the
entire core loop in a new runtime. Hence: React-harness first, Electron
additive, ship whichever passes G3. This is locked — PR against `AGENTS.md`
to relitigate, don't drift silently.

## 10. Definition of done

- [ ] Channels + preview alive (G1); git tested by script; executor skeleton accepted.
- [ ] Real edit → real commit → undo works (G3); Tier-1 renderer sub-2s measured.
- [ ] Failure envelopes truthful (`build-failed`, `not-ready`, `wv-gone`); retry cap enforced.
- [ ] STT reliable on stage mic; TTS either tested-by-G4 or cut.
- [ ] No decision logic in shell (no intent/target/route code outside Dev B's types); `tsc --noEmit` strict green.
- [ ] Look→speak→change→undo ×3 without intervention on the shipped shell (or harness).
