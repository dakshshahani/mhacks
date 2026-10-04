# Gaze

*Cursor, but you point with your head and direct with your voice.*

Look at a UI element, say what you want, the code changes live. Every edit auto-applies with a 5s undo circle — no Git knowledge needed.

## How it works

```
gaze/head pose → probe → Jev decides → Tier-1 patch or Flash-Lite edit → build gate → HMR → undo circle
```

1. **Look** — head/nose tracking (MediaPipe face-landmarker, `apps/frontend/.../gaze-provider.tsx` + `apps/desktop/src/gaze/`) maps to viewport point → injected probe (`apps/desktop/src/probe.js`) returns `GazeFrame` (2–5 candidates, DOM order, JSON-safe). Overlay highlights; click is the fallback override.
2. **Speak** — Web Speech primary + ElevenLabs Scribe fallback recorded in parallel (key stays server-side, `POST /api/transcribe`). Mic chip shows `elevenlabs-trial` sponsor badge. Transcript is editable before apply. TTS was cut — STT only.
3. **Decide (Jev, TypeSafe AI)** — `packages/orchestrator/src/jev.ts` asks closed catalogs built from live state: actionable (noul), target (choice over candidate ids), intent, op, param, route (`no-llm`/`small`/`large`), risk (low/med/high → score), inCatalog (noul). No HTML crosses into Jev (injection rule). Timeout/failure falls back to `mockJev`. Verify is one advisory noul pass on small/large only.
4. **Edit** — `composeEditRequest` enforces closure: below `AUTOMATION_MIN` or unexecutable op/param → `op=null`, route escalates to `small`. `no-llm` runs the deterministic Tier-1 renderer (`packages/shell/src/tier1.ts`, 8 ops: `set-color/radius/spacing/align/weight/size`, `hide`, `swap-text`); anything else calls Gemini 3.5 Flash-Lite (`CODE_MODEL`, temp 0.1) for full-file replacement text. Executor (`packages/shell/src/executor.ts`) is the truth boundary: containment gate, build gate with ≤3 error-fed retries then revert + fail card, pre-commit snapshot per edit.
5. **Undo** — risk widens the undo window (5s, 8s if `riskScore >= APPLY_THRESHOLD`). ~500ms dwell or click on the undo circle reverts. No Confirm dialogs in the demo path.

Pipeline: `idle → listening → locked → editing → verifying → applied | failed` (`packages/orchestrator/src/pipeline.ts`). Single entry: `decideAndEdit` in `apps/desktop/src/decide.ts`.

## Repo layout

```
packages/contracts/src/   gaze.ts · agent.ts · decision.ts (POLICY) · ipc.ts · mocks/
packages/orchestrator/src/ jev.ts · compose.ts · codeAgent.ts · pipeline.ts   (Dev B)
packages/shell/src/        executor.ts · tier1.ts · git.ts · preview.ts · speech.ts · devServer.ts · fileIndex.ts · safeStorage.ts · ipcRouter.ts  (Dev C)
apps/frontend/             Next.js workspace UI (gallery, /{project}, pricing mocked, voice-prompt, gaze blob)
apps/desktop/src/          browser harness: renderer.js client, gaze/controller, decide.ts seam, dev-server.mjs (:5173)
```

`packages/contracts` is the only shared artifact (types/pure functions, `IpcResult<T>` envelopes, `tsc --noEmit` strict). Import from `@mhacks/contracts` only.

## Policy (`decision.ts:POLICY`)

`APPLY_THRESHOLD 0.8` (widens undo, never a dialog) · `AUTOMATION_MIN 0.7` · `ACTIONABLE_MIN 0.6` · `RETRY_THRESHOLD 0.7` · `MAX_RETRIES 3` · `MAX_CANDIDATES 5` · `DECISION_TIMEOUT_MS 1500`.

## Git-as-buttons (`shell/src/git.ts`)

| UI | Under the hood |
|---|---|
| New Version | `git:createSnapshot` |
| Undo | `git:undo` (tip back one commit) |
| Version history | `git:history` (session branch, stable across detached view) |
| View version | `git:checkout` (detached HEAD, tip untouched) |
| Revert here | `git:revertTo` (force-move branch, drop above) |
| Confirm | `git:confirm` power-path only |

Nested repo per project, repo-local `gaze` identity, stash-before-destroy, `ensureBaseline` so Undo works on edit #1.

## Run it

```sh
cp .env.example .env   # TYPESAFE_API_KEY, GEMINI_API_KEY, ELEVENLABS_API_KEY
pnpm install
# terminal 1 — harness (demo tree, :5173)
pnpm --filter @mhacks/desktop dev   # or: pnpm dev in apps/desktop
# terminal 2 — frontend
pnpm --filter @mhacks/frontend dev  # HARNESS_URL=http://127.0.0.1:5173 to override
```

Open `/demo` (supervised, editable) or gallery projects (preview-only unless supervised). Custom preview URLs need iframe-embed permission. Demo loop: click element → type/speak → Send → Undo within 5s → history pane (click to view, click again to revert).

## Demo bar

Look→speak→change→undo ×3 unaided · ≥80% gaze-hit on demo project · catalog edits sub-2s (~70–80% of script) · judge can undo with no Git.
