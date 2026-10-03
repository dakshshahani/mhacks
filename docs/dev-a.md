# Dev A — Gaze Client (webview-side only)

> Branch: `dev/gaze` · Load: ~20% · Features: F2, F3, F8
> Sources of truth: `AGENTS.md §5` (seams), `docs/PRD.md §7` (F2/F3/F8),
> `docs/grill-decisions.md` (overrides PRD), `docs/team-plan.md` (Dev A),
> `docs/kickoff.md` (hour-0 plan). Contracts: `packages/contracts/src/gaze.ts`, `ipc.ts`.

## 1. Mission in one sentence

Turn a raw `(x, y)` gaze point into a JSON-safe `GazeFrame` with 2–5 ranked
element candidates that Jev (Dev B) can disambiguate and the overlay (PM) can
highlight — at component granularity, in any webview, with a click fallback
that guarantees the demo never stalls.

You do **not** render the highlight box, decide intent, edit files, or touch
git. You produce the frame; others consume it.

## 2. Ownership seam (hard boundary)

| You own | You never own |
|---|---|
| `(x, y) ⇒ Promise<GazeFrame>` working in any webview | Overlay rendering (PM) |
| Calibration screen (9-point, ~30s, re-runnable) | Agent / Jev / pipeline (Dev B) |
| Smoothing + dwell + snap + lock-on + click override | File edits, git, IPC res side (Dev C) |
| `data-source` Vite/Babel plugin (template repo only) | Business logic, token catalogs |

Pipeline state machine is Dev B's. You emit typed data into it; never mutate
it. Every other package imports from `@mhacks/contracts` — never from your
source tree.

## 3. Contracts you produce / consume

Produced (`gaze.ts` — you are the only writer):

```ts
QueryElementAt = (x: number, y: number) => Promise<GazeFrame>
ElementCandidate {
  id: CandidateId          // join key INSIDE one GazeFrame. Stable per probe,
                           // not durable across frames. Never match on selector.
  selector: string
  componentName: string | null
  filePath: string | null  // from data-source attr; null if unmapped
  boundingRect: JSONRect   // {x,y,width,height} — NO DOMRect, NO functions, NO Maps
  outerHTMLSnippet: string // truncated to 2KB
  htmlTruncated: boolean
  confidence: number        // 0-1: tracker quality + snap penalty
  trackedConfidence: number // 0-1: raw tracker only
  supportedOps: EditOp[]   // Tier-1 ops this element can take (feeds Dev B catalog)
}
GazeFrame {
  candidates: ElementCandidate[] // top 2-5, DETERMINISTIC DOM order, never shuffled
  lockedTarget: ElementCandidate | null // set when speech starts
  capturedAt: number
}
GazeState { frame, calibration: "uncalibrated"|"calibrating"|"calibrated",
            sensitivity: { dwellMs, smoothing } }
```

Consumed:

- `preview:queryElementAt: {req:{x,y}, res:IpcResult<GazeFrame>}` — Dev C
  implements the channel; your probe function is what runs inside the webview.
- `preview:setCalibration` — calibration status reporting.
- `speech:state: "off"|"listening"|"processing"` (event) — when it flips to
  `listening`, freeze `lockedTarget`. Jitter must not retarget mid-sentence.
- `EditOp` / `COLOR_TOKENS` etc. from `agent.ts` — for `supportedOps`. Token
  lists freeze at hour 3 from PM's design tokens; your prober must not invent
  its own color names.

Contract rules (`AGENTS.md §6`): stable `id` join key, JSON-safe across
webview/IPC, envelope errors (`IpcResult`), deterministic option ordering
(never shuffle — ordering is part of Jev's input), calibration-first (margin
≠ P(correct)).

## 4. Grill decisions that constrain you (do not relitigate)

1. **WebGazer.js, tested on a team laptop.** PRD's "100–200px error" is
   vendor-adjacent. You must produce **our own** accuracy number on the demo
   project by hour 14. Target: ≥80% highlight-correctness at component level.
2. **Component granularity, not pixel.** Snap to nearest meaningful block-level
   element. Pixel-chasing will fail; snapping is the product.
3. **Undo circle dwell ~500ms (or click).** Your dwell detector fires it. Test
   false-fire rate before the demo — a circle that fires when the judge just
   reads the screen kills the finale.
4. **Click-to-override is mandatory.** Gaze will jitter on stage. Click selects
   and guarantees a fallback so look→speak→change→undo ×3 never blocks.
5. **Demo target is the generic, highly-editable template site.** `data-source`
   mapping only needs to work there. Open-repo / import-URL stay visible as
   "not yet" paths — you do not support them.
6. **Shell is React-first.** Your probe must work in a plain browser page
   FIRST (hour 4), then in Dev C's embedded webview (hour 6). If Electron
   slips, the browser harness ships and your code still runs.
7. **Sensitivity slider (F8, P1) maps to your settings.** `dwellMs + smoothing`
   — wire it as `GazeState.sensitivity`, owned by you, rendered by PM.

## 5. How it must work (implementation spec)

### 5.1 Tracker + calibration

- WebGazer.js in the preview webview (or the plain-page probe first).
- Calibration screen: 9 points, ~30s, re-runnable anytime. Emit
  `preview:setCalibration` (`calibrating` → `calibrated`).
- Expose calibration quality if the library gives it; otherwise expose
  `trackedConfidence` per candidate and let Dev B gate on it.

### 5.2 Smoothing + dwell

- Moving-average over recent gaze samples. `smoothing` factor comes from
  `GazeState.sensitivity.smoothing` (slider).
- Dwell threshold ~300–600ms for target lock, **~500ms for the undo circle**
  (locked grill value). `dwellMs` comes from the same sensitivity object.
- Tune both against the false-fire measurement (§8), not by feel.

### 5.3 Element probing (the core function)

Pseudocode for `queryElementAt(x, y)`:

```
1. raw = document.elementsFromPoint(x, y)           // inside webview
2. filter to visible, non-overlay elements (ignore PM's highlight layer by
   data attribute, e.g. [data-gaze-overlay] — agree the attribute with PM once)
3. walk each hit up to nearest block-level ancestor
   (div/section/button/h1-h6/p/card — maintain an explicit SNAP_TAGS list)
4. dedupe by element, take top 2-5
5. order DETERMINISTICALLY (document order — never sort by confidence)
6. for each: id = per-probe counter ("c0","c1"…), selector = cheap stable
   selector (for debug only — NOBODY joins on it), componentName from
   data-source / React fiber displayName if available else null,
   filePath from data-source attr else null,
   boundingRect = getBoundingClientRect() → {x,y,width,height},
   outerHTMLSnippet = outerHTML.slice(0, 2048), htmlTruncated flag,
   confidence + trackedConfidence, supportedOps (see below)
7. return { candidates, lockedTarget: null, capturedAt: Date.now() }
```

Rules:

- 2–5 candidates always (Jev `choice` cardinality ≤5 by our design, ≤255
  supported). 1 candidate = no disambiguation needed but still return array.
- `supportedOps`: declare what Tier-1 patching this element supports, e.g.
  heading → `[{op:"set-color"…}, {op:"swap-text"…}]`, button →
  `[{op:"set-radius"…}]`. Keep it honest — Dev B builds its closed catalog
  from this + design tokens. Over-claiming routes to `no-llm` and produces a
  broken patch.
- `outerHTMLSnippet` never carries `<script>` contents into `DecisionInput`
  verbatim — Dev B strips untrusted content before Jev (prompt-injection
  rule). Truncate + flag.

### 5.4 `data-source` plugin (riskiest piece — scope it down)

- Vite (preferred) or Babel plugin injecting `data-source="file:line"` (or
  `file:line:col`) attributes at dev time.
- Runs **against the template repo only**. Foreign repos are out of scope for
  the demo (locked).
- Deliverable: open the template page, inspect any hero/button/card, see a
  `data-source` attribute that resolves to a real `filePath`. Dev B's agent
  depends on this for `EditRequest.target.filePath`.
- If the plugin slips, fallback is a static map for the 5–8 demo elements
  (hero heading, hero sub, primary button, 2–3 cards, navbar). Ugly but
  demo-safe. Decide by hour 8.

### 5.5 Lock-on + click override

- Subscribe to `speech:state`. On `listening`: copy current best candidate
  into `lockedTarget` and freeze it until `processing`/`off` or new utterance.
- Click anywhere in preview (when armed): run `queryElementAt(click.x,
  click.y)`, take `candidates[0]` as `lockedTarget`. This is the demo safety
  net — test it every gate.

## 6. Hour-by-hour plan (24h clock)

| Hour | Do | Done looks like |
|---|---|---|
| 0–2 | WebGazer probe in plain HTML page. Calibration + console-logged `GazeFrame`-shaped object. No shell needed. | Gaze dot follows eyes on your laptop |
| 3 | **Contracts freeze.** Shout NOW if `gaze.ts` shape blocks you. Hand `supportedOps` vocabulary to Dev B. After hour 3, contract changes cost a PR + everyone rebases. | `pnpm --filter @mhacks/contracts check` green on `main` |
| 4 | `queryElementAt` works in plain browser page (before shell). SNAP_TAGS + DOM-order + truncate + `data-source` read. | Call it from console, get 2–5 candidates with `filePath` on template |
| 5 (G1) | Integrate with Dev C's channel stubs + PM's mock screens. Mock edit appears via UI buttons. | Your frame renders as a highlight (PM draws it; you supply rects) |
| 6 | Same function inside embedded preview webview over `preview:queryElementAt` IPC. Overlay-ignore attribute agreed with PM. | Gaze in the real shell highlights the right card |
| 8 (G2) | **Gate:** real gaze + real speech → mock edit in real DOM. Your `GazeFrame` is what Jev disambiguates. | Judge path works with mocks downstream |
| 9–13 | Harden: smoothing/dwell tuning, `data-source` plugin on full template, click override, slider wiring. | No "gaze jumped mid-sentence" bugs |
| 14 | **Accuracy number.** Measure ≥80% highlight-correctness on the demo project (scripted 10–15 targets). Log method. | Slide-ready stat, ours not vendor's |
| 15–20 | Undo-circle dwell testing: 500ms fires reliably; measure false-fire rate; tune. Re-run accuracy after each change. | Dwell fires on look, never on read-through |
| 21 (G5) | Outsider test: someone outside the team does look→speak→change→undo unassisted. | Pass or file the P1 cut |

Gate rule: a feature that misses its gate drops to P1 immediately.

## 7. Integration protocol (how parallel branches stay safe)

- Work on `dev/gaze`. Pull `main` after Dev B lands mocks (hour ≤3) — never
  pull sibling branches directly.
- Import only from `@mhacks/contracts`. Never import Dev B/C source.
- PRs into `main` reviewed by Dev B (fast — semantics, not style).
- Run `pnpm --filter @mhacks/contracts check` before every push.
- G1 readiness from Dev C: channel skeletons returning `not-ready` envelopes.
  Build against those; do not wait for real git/executor.

## 8. Testing + demo safety

- [ ] `queryElementAt` returns 2–5 candidates, DOM-ordered, JSON-serializable
  (`JSON.stringify` round-trip test).
- [ ] `filePath` non-null for all demo-script elements (hero, button, cards).
- [ ] Lock-on: start speech mid-jitter → target frozen (manual test, log it).
- [ ] Click override selects the clicked element 100% of the time.
- [ ] Sensitivity slider changes `dwellMs`/`smoothing` live.
- [ ] Undo dwell: 500ms gaze fires undo; reading the screen for 5s does not
  (false-fire rate measured, not vibes).
- [ ] Accuracy script: N scripted targets, % where `candidates[0]` or
  Jev-picked target == intended. Target ≥80%.
- [ ] Camera-fail fallback rehearsed: click-only full demo + pre-recorded
  video exists (PM owns video; you own click path).

## 9. Failure modes to build for

| Symptom | Mitigation (yours) |
|---|---|
| Jitter (±100–200px) | Smoothing + snap + dwell; never expose raw point as target |
| Tracker lost (low light, glasses) | `trackedConfidence` drops → Dev B can escalate; surface `uncalibrated` state |
| `filePath` null (unmapped element) | Still return candidate; Dev B routes to `large`/fail card, not a wrong file |
| Webview not ready | Return `IpcResult {ok:false, code:"not-ready"}` — never throw across IPC |
| Overlay self-hit (`elementsFromPoint` returns highlight box) | Ignore `[data-gaze-overlay]` subtree — coordinate with PM |

## 10. Definition of done

- [ ] `queryElementAt` + calibration + smoothing/dwell + lock-on + click
  override working in the shipped shell (or browser harness if Electron cut).
- [ ] `data-source` attributes present on all demo elements of the template.
- [ ] Accuracy ≥80% measured + logged; dwell false-fire rate measured.
- [ ] No imports outside `@mhacks/contracts`; `tsc --noEmit` strict passes.
- [ ] Look→speak→change→undo ×3 in a row without manual intervention (with
  the team clicking only if gaze drops — the fallback counts).

## 11. Demo-script lines you enable

> "Look at the hero heading → overlay locks on → say 'make this bigger and
> use a gradient.'" / "Look at a button → 'make it rounded…'" / "Undo one
> edit by looking at the undo circle."

If the highlight is wrong, nothing downstream matters. Your correctness IS
the demo's first impression.
