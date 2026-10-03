# Team Plan — per-dev deep dive (24h hackathon)

Companion to AGENTS.md. Contracts: `packages/contracts/`. Locked decisions in
`docs/grill-decisions.md`. Load ratio B 40 / C 25 / A 20 / PM 15.

---

## Dev B — Orchestrator (the integration hub)

**Works with:** Jev API (`api.typesafe.ai/v1/systemone`, live key in hand),
Haiku-class small model, the contract types, the pipeline state machine.

**What they own:**
1. `packages/contracts/` — definitions AND the two mocks (`mockAgent`,
   `mockJev`). Frozen hour 3; every cross-team PR routes through them.
2. `DecisionLayer` — Jev client. Builds question sets at call time from
   `DecisionInput.components` (closed catalog: target × op × param), sends
   trimmed state (< 20k tokens, `POLICY.STATE_TOKEN_BUDGET`), maps answers
   into a `Decision`. Behind one interface so the cheap-LLM stub can swap in
   if Jev misbehaves mid-demo.
3. `CodeAgent` — Haiku client: gets path + component pre-resolved by Jev, so
   no wide codebase search. Output constrained to a narrow diff. Runs agent
   loop for `large` route only.
4. Tier-1 patch renderer — the `EditOp` union becomes deterministic
   class-list/string edits. This is the sub-2s path.
5. Pipeline state machine — `idle → listening → locked → editing →
   verifying → applied | failed`, emits `PipelineState` (including
   `undo-window` pending action) over `pipeline:state` events.

**Specific deliverables:**
- Hour 3: contracts frozen + mocks working (`contracts` repo check green)
- Hour 5 (G1): mock edit appears in the preview, driven by UI buttons
- Hour 8 (G2): Jev disambiguates real gaze + real ElevenLabs transcript →
  mockAgent applies. Sub-2s measured on catalog edits
- Hour 10 (G3): `mockJev` → real Jev; real Haiku edit through Dev C's
  executor; build-fail envelope exercised
- Hour 17 (G4): full real pipeline; latency budget re-measured on real LLM
  (vendor numbers were self-reported — measure ours)

**Never owns:** mic internals, git plumbing, overlay rendering.

**Failure modes to build for:** Jev timeout (>1.5s → route directly to LLM),
inCatalog < 0.7 → escalate, Haiku build-fail (RETRY POLICY — see objection in
grill-decisions), transcript empty → drop as chatter.

---

## Dev A — Gaze client (webview-side only)

**Works with:** WebGazer.js (already tested on a laptop pre-hack), DOM APIs,
the `queryElementAt(x, y) => Promise<GazeFrame>` contract.

**What they own:**
1. Calibration screen: 9-point, ~30s, re-runnable; emits
   `preview:setCalibration` status.
2. Smoothing & dwell: moving-average gaze; dwell threshold ~500ms
   (undo-circle dwell) tied to the sensitivity slider (F8).
3. Element probing inside the webview: `document.elementsFromPoint` →
   nearest block-level ancestor snap → build top-2–5 `ElementCandidate[]`
   with deterministic (DOM) ordering, stable per-frame `id`s.
4. `data-source` Vite/Babel plugin: injects `file:line` attributes on our
   template project at dev time — this is what turns candidates into
   `filePath` mappings. Run against the template repo early.
5. Lock-on: when speech starts (`speech:state` event), freeze
   `lockedTarget` so jitter can't retarget mid-sentence.
6. Click-to-override: click selects/guarantees a fallback (demo safety).

**Specific deliverables:**
- Hour 4: `queryElementAt` works in a plain browser page (before shell)
- Hour 6 (after Dev C's preview): same function working in the embedded
  preview webview over IPC
- Hour 9 (G2): their `GazeFrame` is what Jev disambiguates
- Hour 14: substantiated accuracy number on the demo project (PRD claims
  ~80%; must be *our* measurement, not vendor's)
- Undo circle dwell testing: 500ms fires reliably; measure false-fire rate
  and tune before the demo

**Never owns:** overlay rendering (PM), agent, Ember files.

---

## Dev C — Shell & side effects (the real world)

**Works with:** Electron/React shell, `<webview>`/BrowserView, `git` plumbing,
processes, all speech plumbing (STT P0 + P2 TTS), tier-1 patch renderer.

**What they own (in integration order):**
1. App shell + embedded preview running a managed dev server (F1).
   - Unblocks both Dev A and PM. Hour 4.
2. IPC channel skeletons for every entry in `ipc.ts` — wired, returning
   envelope `not-ready` stubs. Hour 3–4 (G1 readiness).
3. Git service as a standalone Node module first (tested by script against
   the template repo), then wrapped in `git:*` channels: `createSnapshot`
   (worktree+branch), `undo`, `confirm`, `history`.
4. Edit executor: accepts `EditRequest` from the channel, applies in
   worktree, runs build/lint gate, pre-commits, returns truthful
   `EditResult` (real `commitSha`, real `hotReloaded`).
5. Dev-server manager: spawn/restart/HMR detection (source of
   `hotReloaded` truth).
6. Speech plumbing — ALL speech work is Dev C's, behind the same `speech:*`
   channels: **STT** (command capture: Web Speech primary, ElevenLabs Scribe
   fallback) is P0; **TTS** (agent narration, F14) is P2 — deterministic
   template sentence from `EditResult`, drop-cut is an `<audio>` element,
   must be tested by G4 or it doesn't ship. Estimated: 1h for STT path.
7. **Tier-1 patch renderer (final split):** `EditOp` union → deterministic
   className/string edits. Reassigned from Dev B (grill pass) — pure code,
   no model access, executor-side (Dev C). ~2h. The sub-2s path lives here.
8. ~~BYOK~~ — display-only (billing mocked; locked). PM owns the key field
   UI; Dev C adds a ~20-line `safeStorage` wrapper after G3 only if time.
9. Electron wrap — LAST, only after G3 passes. If not done by the demo,
   the React/browser harness ships (locked decision).

**Specific deliverables:**
- Hour 4 (G1): channels + preview alive; PM demos mock flow end-to-end
- Hour 8: git service tested by script; executor skeleton accepted
- Hour 10 (G3): real edit lands through Dev B's agent → real commit →
  undo works. The one-line mock→real swap is Dev C's definition of done
- Hour 17 (G4): failure paths exercised (build-failed envelope, undo inside
  window, webview not-ready)

**Never owns:** deciding what an EditRequest contains (that's Dev B).

---

## PM / Designer / FE (minimal code experience)

**Works with:** Figma, the excalidraw app-states (`docs/design/`), contract
types, mockAgent events, AI builders (v0/Cursor-class) for any code.

**What they own:**
1. Glass design system: tokens (Colors/Radii/Spacing — frozen hour 3; Dev B's
   token catalogs must match them exactly), transitions, blur/border specs.
2. Per-state screens from the excalidraw: idle / listening / locked /
   editing / verifying / applied / undo-window / failed — one screen each,
   using `PipelineState` as the state source.
3. The undo circle: 5s, ~500ms dwell, click fallback, fades. This is THE
   interaction of the demo — polish it hardest.
4. Mission status toasts ("Editing Navbar.tsx…"), mic state chip
   (visible EleveLabs-sponsor badge — disclosure rule from grill).
5. Sensitivity slider (dwell + smoothing → maps to Dev A settings).
6. Version timeline (from `git:history` events; mocked first).
7. Pricing cards + local token counter (mocked — no Stripe; locked).
8. Landing page: designed in Figma → vibecoded *inside our own app* by the
   PM (dogfood finale); requires static Figma-export fallback by hour 20.

**Specific deliverables:**
- Hour 3: design tokens frozen (feeds Dev B's `COLOR_TOKENS` etc.)
- Hour 5 (G1): state screens rendering against mockAgent
- Hour 12: all 8 screens + undo circle polished against mock pipeline
- Hour 20: landing page fallback exists regardless

**Never owns:** business logic behind the states; any contract semantics.

---

## Shared timeline (all gates)

| Gate | Hour | Crossing test | Owner of risk |
|---|---|---|---|
| G1 | ~5 | UI + mockAgent end-to-end via Dev C channels | Dev C |
| G2 | ~8 | Real gaze + real speech → mock edit in real DOM | Dev A, Dev B |
| G3 | ~10 | Real Jev + real Haiku edit, real commit + undo | Dev B, Dev C |
| G4 | ~17 | Full real pipeline incl. undo circle + tiers | everyone |
| G5 | ~21 | Someone outside the team: look→speak→change→undo unassisted | PM |

Gate rule: a feature that misses its gate drops to P1 immediately.
