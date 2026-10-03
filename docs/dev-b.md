# Dev B — Orchestrator (the integration hub)

> Branch: `dev/orchestrator` · Load: ~40% (heaviest) · Features: F5, F5b
> Sources of truth: `AGENTS.md §2,5,7` (two-model design, seams, policy),
> `docs/PRD.md §7` (Jev layer + code agent), `docs/grill-decisions.md`
> (overrides PRD), `docs/team-plan.md` (Dev B), `docs/kickoff.md`.
> Contracts: `packages/contracts/src/decision.ts`, `agent.ts`, `index.ts`.

## 1. Mission in one sentence

Own the decision pipeline — speech + gaze in, committed edit out — by freezing
`packages/contracts/`, implementing the Jev `DecisionLayer`, the 3.5 Flash-Lite
`CodeAgent`, and the pipeline state machine that everyone else renders against.

You are the only person who may approve contract PRs. You are the router that
keeps 70–80% of the demo on the sub-2s path.

## 2. Ownership seam (hard boundary)

| You own | You never own |
|---|---|
| `packages/contracts/` definitions + `mockAgent` / `mockJev` (frozen hour 3) | Mic internals, speech streams (Dev C) |
| `DecisionLayer` — Jev client + cheap-LLM stub behind one interface | Git plumbing, worktrees, dev-server (Dev C) |
| `CodeAgent` — 3.5 Flash-Lite client, narrow diff, agent loop for `large` only | Overlay rendering, screens (PM) |
| Pipeline state machine `idle → listening → locked → editing → verifying → applied \| failed` | Gaze probing inside webview (Dev A) |
| `POLICY` thresholds + probe harness (`npm run probe`) | Deciding pixels; you emit `PipelineState`, PM renders it |

Type split with Dev C (final grill split — do not relitigate):

- You own the `EditOp` **union + token catalogs** in `agent.ts` (the vocabulary).
- Dev C owns the Tier-1 **patch renderer** (the executor that turns
  `EditOp → deterministic className/string edit`). It lives executor-side
  because it is pure code, no model access. You define what ops exist; Dev C
  implements them exhaustively. Adding an op means updating the union +
  Dev C's switch together.

## 3. The two-model design (do not relitigate)

Jev (TypeSafe AI, System One) **decides**; an LLM **edits**. Jev cannot
generate text or code. It returns typed values over options **you enumerate**:

- `choice` — one of ≤5 elements you build at call time (≤255 supported)
- `score` — 2–10 ordered scale (we use 0–1 normalized)
- `noul` — calibrated yes/no probability

Jev output is never shown as prose. Every user-facing string
(`"Editing Navbar.tsx…"`) is written by our code.

| Decision | Jev type | Used for |
|---|---|---|
| Intent | `choice`: `style\|layout\|content\|add\|delete\|other` | Picks edit prompt + tools |
| Gaze disambiguation | `choice` among 2–5 candidates near gaze + transcript | Resolves "this" when gaze jitters |
| Actionable? | `noul` | Drops background chatter / filler |
| Apply policy | `score` → `riskScore` 0–1 | **Grill-locked:** widens the 5s undo-window; NEVER a Confirm dialog |
| Route | `choice`: `no-llm\|small\|large` | Token-spend control, sub-2s law |
| Verify | `noul`: diff/screenshot matches ask? | One retry max (see §7 objection) |

Why Jev at all: ~70–500ms, ~$0.001/decision, runs on **every** utterance.
Vendor numbers are self-reported — you re-measure latency + cost in Phase 1.

Keys are RESOLVED pre-hack: Jev live key probe-tested (6 real decisions
against `api.typesafe.ai`), 3.5 Flash-Lite code model (thinking off) chosen. No waiting.

## 4. Contracts you own (current shape + required grill fixes)

### 4.1 `decision.ts` — you produce/consume

```ts
DecisionInput {
  transcript: string
  pointer: {x,y} | null
  pointerOver: string | null
  components: ElementCandidate[]  // visible list — THE criteria source
  textSpans?: string[]            // candidate spans extracted from transcript
}
Decision {
  actionable: number  // noul; < ACTIONABLE_MIN → drop as chatter
  target: string | null  // CandidateId from components, null if not actionable
  intent: Intent
  op: string | null   // catalog verb; null + route=llm means generate
  param: string | null
  route: Route        // no-llm | small | large
  riskScore: number   // 0-1; grill: widens undo window, NOT a dialog gate
  inCatalog: number   // noul; < AUTOMATION_MIN → escalate to LLM
  confidence: number  // MARGIN, not P(correct)
}
DecisionLayer { decide(input: DecisionInput): Promise<Decision> }
VerifyDecision { matches: number }  // < RETRY_THRESHOLD → one retry
POLICY = {
  APPLY_THRESHOLD: 0.8, AUTOMATION_MIN: 0.7, ACTIONABLE_MIN: 0.6,
  RETRY_THRESHOLD: 0.7, MAX_CANDIDATES: 5,
  DECISION_TIMEOUT_MS: 1500, STATE_TOKEN_BUDGET: 20_000
}
```

⚠️ **STALE COMMENTS — fix in your first contract PR (hour ≤3):**

1. `decision.ts:42` comment `>= APPLY_THRESHOLD requires Confirm` is VOID.
   Grill: auto-apply **every** edit; risk widens the undo window instead.
   Update comment to `riskScore widens undo-window duration; no Confirm in demo path`.
2. `agent.ts:35` comment `>=0.8 auto-apply, otherwise Confirm required` — same fix.
3. `agent.ts:69` `PendingAction = "undo-window" | "confirm" | null` still
   carries `"confirm"`. Grill delta says it is now `"undo-window" | null`
   (Confirm survives only as the power-path `git:confirm` on a pre-commit sha,
   never as a demo gate). Shrink the union or keep `"confirm"` strictly as
   dead power-path — decide explicitly and document it in the PR.
4. `POLICY.APPLY_THRESHOLD` stays as the **window-widening** threshold, not a
   dialog gate. Tuning it requires noting the probe run that informed it.

### 4.2 `agent.ts` — you produce, Dev C executes

```ts
EditOp = {op:"set-color",param:ColorToken} | {op:"set-radius",param:RadiusToken}
       | {op:"set-spacing",param:SpacingToken} | {op:"hide",param:null}
       | {op:"swap-text",param:string}
COLOR_TOKENS = ["brand","muted","accent"]  // frozen from design.md hour 3
RADIUS_TOKENS = ["sm","md","lg","full"]
SPACING_TOKENS = ["tight","normal","loose"]
EditRequest { id, transcript, intent, target: ElementCandidate,
              op: EditOp | null, route, riskScore }
EditResult { id, status: "applied"|"build-failed"|"retry-exhausted",
             filesChanged, commitSha, durationMs, hotReloaded }
CodeAgent { submitEdit(req: EditRequest): Promise<EditResult> }
PipelineStage = idle|listening|locked|editing|verifying|applied|failed
PipelineState { stage, editId, pendingAction: PendingAction,
                statusLine, error }
```

`COLOR_TOKENS` etc. must match PM's frozen design tokens **exactly** (hour 3).
If PM renames `brand` → `primary`, your catalog + Dev C's renderer + Dev A's
`supportedOps` all change together — that is why tokens freeze.

### 4.3 Contract rules you enforce on everyone

1. Stable `ElementCandidate.id` join key inside a `GazeFrame`; never silent
   selector matching.
2. JSON-safe across webview/IPC. No functions/Maps/DOMRects; `boundingRect`
   is `JSONRect`.
3. Errors are `IpcResult<T>` envelopes. No null-by-convention.
4. Calibration-first: Jev confidence is a margin; Jev is prompt-injectable —
   **never let untrusted web content (`outerHTMLSnippet`, URL text) flow into
   a `DecisionInput` field that maps to an action.** Strip/allowlist before
   building criteria. Log inputs/outputs for debugging; show confidence in UI
   where useful.
5. Determinism: option ordering in criteria is part of Jev's input — never
   shuffle. Dev A's DOM order must survive untouched through your layer.

Definition of done for any contract PR: types only or pure functions, no I/O;
reference only sibling contract types; envelope `res`; `tsc --noEmit` strict
passes; mocks updated; `AGENTS.md` updated if semantics changed.

## 5. DecisionLayer implementation spec

```
build DecisionInput (trimmed < STATE_TOKEN_BUDGET 20k, stay under Jev 32k)
  transcript (final speech token) + pointer + components (2-5, DOM order)
  + textSpans (naive noun-phrase/quoted-span extraction — keep it dumb)
→ Jev decide() with closed catalog: target × op × param
  e.g. "hero" + set-color + brand → deterministic patch fn
→ Decision { actionable, target, intent, op, param, route, riskScore, inCatalog }
→ if actionable < 0.6 → drop (chatter)
→ if inCatalog < 0.7 → escalate to LLM (NEVER force a choice when truth isn't in catalog)
→ else route:
   no-llm → emit EditRequest{op} → Dev C renderer → file write → HMR (~1s)
   small  → 3.5 Flash-Lite, narrow diff, path+component pre-resolved (300–800ms)
   large  → frontier/3.5 Flash-Lite agent loop + build check (3–10s, 1–2 demo moments only)
```

Details:

- Build question sets **at call time from live state** (closure device).
  Catalog = `components × EditOp vocabulary × ParamTokens`. Short candidate
  lists; trimmed element context, never whole files.
- Timeout: `DECISION_TIMEOUT_MS 1500ms`. Jev timeout → route directly to LLM
  (or stub). Never stall the pipeline in front of judges.
- Behind ONE interface so the cheap-LLM stub swaps in if Jev misbehaves
  mid-demo. `mockJev` is deterministic — G2 runs on it.
- Sub-2s budget: speech finalize ≤1.5s · Jev ≤0.5s · small-LLM ≤0.8s ·
  build gate only on `large` · Jev-verify skipped on `no-llm` (build + Undo
  covers it).
- Verify pass (Jev `noul`): does diff/screenshot match ask? Below
  `RETRY_THRESHOLD` → one retry (see §7 for the cap-3 grill objection).

## 6. CodeAgent (3.5 Flash-Lite) implementation spec

- Input: `{ transcript, target: {selector, componentName, filePath,
  outerHTML snippet, screenshot crop}, projectContext }`.
  `filePath` comes from Dev A's `data-source` attr — no wide codebase search.
- Config: thinking off (`thinking_budget: 0` / effort `minimal`), temp 0–0.2.
  Streamy first-token behavior is the point — no reasoning preamble.
- Loop (for `large` route only): locate source → propose edit → apply in
  worktree → run build/lint → report. Retry once on failure (see §7).
- Streams short status (`"Editing Navbar.tsx…"`) as `PipelineState.statusLine`
  over `pipeline:state` events.
- Output constrained to narrow diff. Streams into Dev C's executor via
  `agent:submitEdit` (`EditRequest → IpcResult<EditResult>`).
- DOM→source mapping risk: template repo + dev-time attributes only.
  Existing repos are out of scope (locked).

## 7. Retry policy — OPEN OBJECTION, resolve before freeze

Grill log: user chose "unlimited retries"; griller objected (demo-killer —
iteration 7 never converges, churns tokens, stalls pipeline on stage).

Locked counterproposal you must implement unless explicitly re-decided:

- Retry with build-error context appended, **cap 3**, then revert to
  pre-edit state and show a "couldn't apply" card.
- "Unlimited" only for **user-invoked** retry (button/voice "try again").
- `PRD.md §16 Q4` marks this as must-resolve-before-freeze. Log the decision
  in your contract PR. Do not ship silent-unlimited.

## 8. Pipeline state machine (yours alone)

`idle → listening → locked → editing → verifying → applied | failed`

- Others emit typed events into it, never mutate it.
- `pendingAction`: `"undo-window" | null` drives PM's 5s undo circle
  (risky edit → longer/bigger circle). No Confirm dialogs in demo path.
- `pipeline:state` events carry every transition; PM renders all 8 screens
  (idle/listening/locked/editing/verifying/applied/undo-window/failed) from this.
- Truthful `EditResult`: real `commitSha` (Dev C always pre-commits so Undo
  exists), real `hotReloaded` (Dev C's dev-server manager is the source).

## 9. Hour-by-hour plan (24h clock)

| Hour | Do | Done looks like |
|---|---|---|
| 0–3 | **Freeze contracts + mocks.** `decision.ts` grill fixes (§4), `EditOp` union, `POLICY`, `mockAgent` + `mockJev` deterministic. Collect PM token lists → `COLOR_TOKENS` etc. `contracts check` green on `main`. | Everyone unblocked; THE only hour-3 blocker is you |
| 3–5 (G1) | Mock edit appears in preview driven by UI buttons (via Dev C channels). Pipeline emits mock `PipelineState` sequence. | PM demos end-to-end on mocks |
| 5–8 (G2) | Jev disambiguates **real** gaze + **real** ElevenLabs transcript → `mockAgent` applies. Measure sub-2s on catalog edits. | Core loop works with mocks downstream |
| 8–10 (G3) | **Two small swaps, not one big merge:** real agent (~h9: `mockAgent`→3.5 Flash-Lite narrow diff through Dev C executor) then real Jev (~h11: `mockJev`→live Jev). Exercise build-fail envelope. | Real commit + undo works |
| 10–17 (G4) | Full real pipeline; re-measure latency on real LLM (vendor numbers were self-reported); failure paths (build-failed, undo in window, webview not-ready). | Demo script passes 3× |
| 17–21 (G5) | Harden + outsider test (PM runs): look→speak→change→undo unassisted. Freeze tuning with probe-run notes. | Ship or cut to P1 |

Gate rule: feature missing its gate drops to P1 immediately. `large` route +
TTS + landing-vibecode are the first cuts, never the core loop.

## 10. Probe harness + policy tuning

- `npm run probe` (jev-end-style harness): 6+ real decisions against
  `api.typesafe.ai` logged with inputs/outputs/latency/cost. Every `POLICY`
  tune cites the probe run in the PR.
- Keep the cheap-LLM stub alive all 24h. If Jev rate-limits/errors on stage,
  one env flag swaps it in.
- Measure ours: Jev p50/p95, 3.5 Flash-Lite edit round-trip (target <10s; catalog
  <2s), gaze→decision→pixel end-to-end. These numbers go on the pitch slide.

## 11. Testing checklist

- [ ] `decide()` on transcript + 3 candidates picks intended `target` (scripted set).
- [ ] Chatter ("um, so yeah…") → `actionable` < min → dropped, no edit.
- [ ] `inCatalog` low → escalates to LLM, never forces a wrong catalog op.
- [ ] Criteria order shuffled in test → test FAILS (guards determinism).
- [ ] Untrusted `outerHTML <script>` → stripped before Jev, never maps to action.
- [ ] Jev timeout → falls through to LLM without hanging.
- [ ] Build-fail → envelope → retry (≤cap) → fail card + revert, pipeline `failed`.
- [ ] `tsc --noEmit` strict green; mocks satisfy new shapes.

## 12. Definition of done

- [ ] Contracts frozen hour 3 with grill fixes + mocks on `main`.
- [ ] Real Jev + real 3.5 Flash-Lite edit through Dev C's executor; real `commitSha` + undo.
- [ ] Sub-2s measured on catalog edits (70–80% of scripted demo); full edit <10s.
- [ ] Retry cap resolved + logged; verify one-retry (or capped-3) enforced.
- [ ] Look→speak→change→undo ×3 without intervention; ≥80% gaze-pick on demo
  project (Dev A's number, your disambiguation on top).
