# PRD

# **our winning project™️**

> **Key architecture note:** Jev is a *decision model*: it returns choices, scores and calibrated probabilities in ~70-500ms, but it does not generate text or code. This PRD therefore uses a two-model design: Jev for fast decisions, plus a code-generating LLM for the actual edits. We pay for Jev + the code LLM ourselves; ElevenLabs (sponsor) credits power the demo speech tier (disclosed, not hidden).
> 

---

## **1. Overview**

A developer tool where you build frontend UIs by **looking at an element and talking about it**. Eye tracking identifies which component you mean, speech-to-text captures the instruction, and an agentic backend edits the code and live-reloads the result.

**Example:** Look at the navbar and say "make this sticky and add a blur background." The overlay highlights the navbar, the agent edits the right file, and the preview updates.

**How it works:** Jev makes the fast, structured decisions (what does the user mean, which element, how confident, is it safe to apply). A code-generating LLM writes the edit only when needed.

**One-line pitch:** *Cursor, but you point with your eyes and direct with your voice.*

## **2. Problem & Opportunity**

- Describing UI elements in text prompts is clumsy ("the second button in the card on the right...").
- Non-technical users and designers are blocked by Git and code tooling.
- Pointing plus speaking is how people already direct humans. AI tools don't support it yet.
- No viable way to import/use existing sites as templates

## **3. Goals & Non-Goals**

**Goals (hackathon)**

1. A reliable end-to-end demo: look → speak → UI changes live.
2. A polished product feel (glass UI, pricing page, BYOK) so it reads as a startup, not a script.
3. Safe by default: every change is undoable without Git knowledge.

**Non-goals**

- Production-grade eye-tracking accuracy (we aim for component-level, not pixel-level)
- Supporting every framework (target React/Next.js + Tailwind only)
- Real multi-user collaboration, mobile, or Windows/Linux packaging polish
- Real billing at scale (Stripe test mode is enough)
    - google auth

## **4. Target Users**

| **Persona** | **Need** |
| --- | --- |
| **Frontend dev / hacker** | Faster iteration, hands-free tweaks |
| **Designer / PM (non-technical)** | Change a UI without touching Git or code |
| **Users with accessibility needs** | Reduced keyboard and mouse use |

## **5. Core User Flow**

1. User opens the app and picks a starting point: **new project**, **open local repo**, or **import existing site/URL**. *(Grill decision: import stays in the UI as a "not yet" path — cut entirely from the demo.)*
2. The app runs the project's dev server in an embedded preview.
3. User calibrates eye tracking (about 30 seconds).
4. User looks at an element; the **gaze overlay** highlights the detected component.
5. User holds a hotkey or toggles speech on and says what they want.
6. Agent receives: transcript + target element (DOM path, component name, source file, screenshot crop) → edits code in an isolated worktree.
7. Preview hot-reloads. User clicks **Confirm** or **Undo**.

## **6. Features & Priorities**

**P0 = must be in the demo · P1 = should have · P2 = stretch**

| **#** | **Feature** | **Priority** | **Notes** |
| --- | --- | --- | --- |
| F1 | **Embedded live preview** (webview running the dev server) | P0 | Foundation for everything |
| F2 | **Eye tracking → element mapping** (gaze point → `elementFromPoint` in the preview → component + source file) | P0 | Smooth gaze with a moving average; snap to the nearest meaningful element |
| F3 | **Gaze overlay**: highlight box + label of the detected element | P0 | Confirms to the user what the system "sees" |
| F4 | **Speech-to-text with on/off toggle** (plus push-to-talk) | P0 | Visible mic state indicator |
| F5 | **Code-editing agent (LLM)**: transcript + element context → code diff → apply | P0 | Tool use: read file, edit file, run lint/build. Jev cannot do this step |
| F5b | **Jev decision layer**: intent classification, gaze disambiguation, confidence gating, routing, change verification | P0 (at least intent + confidence gate) | See section 7. Fast and cheap, so it runs on every utterance |
| F6 | **Git-as-buttons**: *New Version* (worktree/branch), *Undo / Version History*, *Confirm* (commit) | P0 | Hide all Git vocabulary |
| F7 | **Design system**: glass UI theme (`design.md` / Figma tokens) | P0 | Built first so all screens share it |
| F8 | **Eye-tracking sensitivity slider** (dwell time + smoothing) | P1 | Easy win; helps demo reliability |
| F9 | **Bring Your Own Key**: paste the API key, stored locally | P1 | Use Electron `safeStorage` |
| F10 | **Project onboarding**: scratch template / open repo / import site | P1 | Scratch template is the safest for the demo. Grill decision: demo target is a deliberately generic, highly-editable template site; import is non-demo |
| F11 | **Payment tiers + usage meter** (Free, Pro, BYOK) | P1 | Stripe test mode; token counter in the UI |
| F12 | **Marketing/landing site + pricing page** on Vercel | P1 | Makes it feel like a product |
| F13 | Multi-select gaze ("these three cards") | P2 |  |
| F14 | Voice replies / agent narration | P2 | ElevenLabs? |
| F15 | Side-by-side version compare | P2 |  |

## **7. Feature Details**

### **Eye tracking (F2, F3, F8)**

- **Primary option:** webcam-based tracking via a JS library (e.g. **WebGazer.js**). No hardware needed, but accuracy is limited (expect roughly 100–200px error), so target *component* granularity.
- **Mitigations for jitter:** smoothing, dwell-time threshold (~300–600 ms, the sensitivity slider), snap to the nearest block-level element, and lock the target when speech starts.
- **Calibration screen** with 9 points, re-runnable anytime.
- **Fallback:** click an element to override the gaze target (must exist for demo safety).

### **Speech (F4)**

- Options: browser Web Speech API, or Whisper/Deepgram streaming. *(Grill decision: ElevenLabs sponsor API wins for the demo tier, backed by the Web Speech fallback contract so we can swap)*
    - wisprflow
    - elevenlabs API (sponsor) — **chosen for demo**
- States: Off / Listening / Processing, always visible.

### **Jev decision layer (F5b)**

Jev takes structured or unstructured state plus typed questions we define in advance, and returns bounded choices, scores or yes/no probabilities with confidence. It gives **no written reasoning**, so we log its outputs for debugging and show confidence in the UI where useful.

| **Decision** | **Jev question type** | **Used for** |
| --- | --- | --- |
| Intent | Choice: `style`, `layout`, `content`, `add element`, `delete`, `question/other` | Picks the edit prompt and tools for the LLM |
| Gaze disambiguation | Choice among the 2-5 candidate elements near the gaze point, given the transcript | Resolves "this" when gaze is jittery |
| Is it actionable? | Yes/no probability | Ignores background chatter or filler speech |
| Apply policy | Score for risk/size of change | *(Grill decision: locked)* Auto-apply **every** edit; risk widens the 5s undo-window instead of gating a Confirm dialog. No Confirm modals in the demo path |
| Route | Choice: `no LLM needed`, `small LLM`, `large LLM` | Controls token spend per tier |
| Verify | Yes/no: does the diff or screenshot match the request? | Triggers one retry before the user sees it |

**Constraints to design around:** choice sets are limited (reported max cardinality of 255, so use short candidate lists); context window is 32K, so send trimmed element context, not whole files; output is not prose, so any user-facing text comes from our code or the LLM. Latency target for the full Jev step: under ~500ms.

### **Code-editing agent (F5)**

- Model: any strong code-generating LLM (to be chosen; see Dependencies). Called only after Jev has set intent, target and risk.
- Input payload: `{ transcript, target: { selector, componentName, filePath, outerHTML snippet, screenshot crop }, projectContext }`.
- Agent loop: locate source → propose edit → apply in worktree → run build/lint → report result. Retry once on failure.
- Streams a short status ("Editing `Navbar.tsx`…") into the UI.
- Mapping DOM → source file: for React, use data attributes injected at dev time (e.g. a Babel/Vite plugin adding `data-source="file:line"`). **This is the riskiest technical piece for existing repos; scope accordingly.**

### **Git-as-buttons (F6)**

| **Button** | **Under the hood** |
| --- | --- |
| New Version | `git worktree add` on a new branch |
| Undo / History | `git restore/reset` / list of commits shown as timestamped snapshots |
| Confirm | `git commit` (optional merge to main) |

Auto-commit a snapshot after each agent edit so Undo is always one click.

### **Design (F7)**

Clean, minimalist, glassmorphism: translucent panels, blur, soft borders, a single accent color, and a dark theme first. Components needed: gaze overlay, mic toggle, sensitivity slider, version timeline, status toast, settings and key modal, pricing cards.

## **8. Business Model (demo-level)**

| **Tier** | **Price** | **Includes** |
| --- | --- | --- |
| **Free** | $0 | Small monthly token allowance, 1 project |
| **Pro** | e.g. $20/mo | More tokens, unlimited projects, version history |
| **BYOK** | $0–$8/mo | Paste your own API key; unlimited usage on your own bill |

**Cost note:** because we pay for everything ourselves, Jev (about $0.04 per million input tokens, free output tokens, per public listings) is nearly free to run on every utterance, while the code LLM is the main cost. Routing "small edits" to a cheaper model via Jev is the margin story for the tiers. *(Grill decision: the code LLM is a Haiku-class small model; tier limits and billing are fully mocked in the demo — pricing cards + local token counter, no Stripe. Pitch references sponsor-subsidized subscriptions.)*

Show a live **token usage meter** in the app and an upgrade prompt when the user hits the limit.

## **9. Technical Architecture (high level)**

- **Desktop:** Electron + React + Tailwind. Preview in a `<webview>`/BrowserView so we can inspect the DOM. *(Grill decision: build React-first; wrap in Electron only if it doesn't threaten the core loop — the demo shell is whichever is running at the G3 gate)*
- **Local services (Electron main):** git operations, file edits, dev server process manager.
- **Decision + edit pipeline:** speech → Jev (intent, target, confidence, risk) → code LLM (edit) → Jev (verify) → apply.
- **Backend:** thin API (Vercel serverless functions) proxying LLM calls, enforcing tier limits, and handling Stripe webhooks. BYOK calls can go direct from the app.
- **Web:** landing page and pricing on Vercel. (The Electron app itself is distributed as a build or DMG, not hosted on Vercel.)

## **10. Dependencies & Blockers**

| **Dependency** | **Why** | **Owner** | **Needed by** |
| --- | --- | --- | --- |
| **Jev API key** (TypeSafe AI is in early access/waitlist; we pay for usage) | Decision layer (F5b) | **✅ RESOLVED — working key, live calls confirmed via probe** | Hour 0 |
| **Code-generating LLM API key** + budget | Code edits (F5) | **✅ RESOLVED — Haiku-class small model chosen** | Hour 0 |
| Jev question schemas (intent, gaze, risk) drafted and tested | Decision layer | Dev B | Hour 4 |
| Eye-tracking library tested on a team laptop | Core feature feasibility | Dev A | Hour 2 |
| Design tokens / `design.md` | All UI work | PM/Designer | Hour 3 |
| Starter React + Tailwind template repo | Safe demo target | Dev B | Hour 4 |
| ~~Stripe test account~~ *(cut — tiers fully mocked in demo grill decision)* | ~~Tiers~~ | PM (mock UI) | n/a |
| Vercel project | Backend + landing | Dev C | Day 2 |

**Build-order dependencies:** F7 (design) and F1 (preview) → F2/F3 (gaze) → F4 (speech) → F5 (LLM agent) → F5b (Jev layer, can be stubbed with an LLM call until access arrives) → F6 (git). F9, F11, F12 are parallelizable.

## **11. Suggested Team Split**

*(Grill decision: contract-first — all cross-team types/mocks live in `packages/contracts/`, frozen hour 3, changed only via PR to Dev B. Integration gates G1–G5 replace an end-of-hackathon merge. See `AGENTS.md` + `docs/grill-decisions.md`. Load ratio ≈ B 40 / C 25 / A 20 / PM 15.)*

- **Dev A:** Eye tracking, calibration, gaze→element mapping, `data-source` plugin, overlay input (F2, F3, F8)
- **Dev B:** Contracts package, Jev decision layer, code-editing agent (Haiku), pipeline state machine, retry policy (F5, F5b)
- **Dev C:** Shell + preview, IPC channels, git service, edit executor + **Tier-1 patch renderer**, speech plumbing — both STT (command capture, Web Speech primary / ElevenLabs Scribe fallback) and TTS (agent narration, P2, behind the same `speech:*` channels) (F1, F4, F5-exec side, F6)
- **PM/Designer/FE:** Design system, glass UI components, undo circle, speech UI (mic chip w/ sponsor badge, transcript states), BYOK field, token meter, pricing cards (mocked), landing and pricing pages, demo script (F7, F11 UI, F12)

**Unblocking rules (final split):** mocks (`mockAgent`/`mockJev`) built in contracts are sanctioned stubs owned by Dev C's envelope work and reviewed by Dev B; the Tier-1 patch renderer is executor-side (Dev C) since it is pure deterministic code against frozen catalogs; BYOK is a display-only field (billing is mocked) — PM owns the UI, Dev C a 20-line `safeStorage` wrapper sometime after G3; gate G3 is done as two small swaps (real agent ~h9, real Jev ~h11) instead of one three-way merge.

## **12. Timeline (24 hours — fixed by grill)**

1. **Phase 1 – Spike (~4.8h / first 20%):** Confirm Jev and LLM keys ✅ (done pre-hack), prove gaze→element on a static page, freeze contracts (hour 3), finalize design tokens.
2. **Phase 2 – Core loop (~9.6h / 40%):** Look + speak + agent edit + reload on the template project. Gates G1–G2 land here.
3. **Phase 3 – Product layer (~6h / 25%):** Undo circle, git buttons, slider, mocked tiers, landing (Figma → vibecoded), G3–G4 gates.
4. **Phase 4 – Polish & demo (~3.6h / 15%):** Bug freeze, rehearse, record backup video, name decided by hour 18.

## **13. Success Criteria**

- Demo completes the look → speak → change → look-at-undo-circle loop **3 times in a row** without intervention.
- Gaze highlight picks the intended component at least ~80% of the time on the demo project.
- Agent edit round-trip under ~10s; catalog edits (≈70–80% of the scripted demo) sub-2s.
- A judge with no Git knowledge can undo a change.

## **14. Risks & Mitigations**

| **Risk** | **Impact** | **Mitigation** |
| --- | --- | --- |
| Webcam gaze is too inaccurate/jittery | Core feature feels broken | Component-level snapping, slider, click-to-select fallback, good lighting in the demo |
| DOM → source file mapping on arbitrary repos | Agent edits wrong file | Demo on our template; use dev-time source attributes; "existing repo" as a stretch |
| LLM edits break the build | Bad demo moment | Worktree isolation, build check, gaze-undo circle. *(Grill decision: user chose unlimited retries — logged objection stands: cap 3 error-fed retries, then fail card. Resolve before freeze)* |
| Speech misrecognition | Wrong command | Show transcript before applying (editable) |
| Import-site promises made on stage | Credibility hit | Cut from demo; answer with "not yet" path |
| Jev access delayed (early access/waitlist) | No decision layer | Build behind an interface; stub with a cheap LLM call, swap in Jev when the key arrives |
| Jev gives no reasoning and can be wrong | Hard to debug misroutes | Log inputs/outputs, show confidence, keep the click-to-select and Undo fallbacks |
| Jev vendor claims are self-reported benchmarks | Speed/cost may differ | Measure our own latency and cost in Phase 1 |
| Scope creep (payments, landing, etc.) | Core loop unfinished | Strict P0-first rule; P1s only after the core loop works |
| Demo-day Wi-Fi / camera issues | Demo fails | Pre-recorded backup, local fallbacks |

## **15. Demo Script (2–3 min)**

1. Open the app and start from the template site (show the glass UI).
2. Calibrate quickly; adjust the sensitivity slider.
3. Look at the hero heading → overlay locks on → say "make this bigger and use a gradient." → auto-applies; point out the 5s undo circle.
4. Look at a button → "make it rounded and add a hover animation."
5. Undo one edit by looking at the undo circle, then show version history.
6. Show the pricing tiers, the token meter, and the BYOK key field.
7. *(If the core loop passed its gates only)* Show the landing page vibecoded inside the app by the PM — dogfooding beat. Fallback: static Figma export.

## **16. Open Questions**

1. ~~Do we have a Jev key yet, and what are its rate limits and our budget? Which LLM do we use for code edits?~~ **RESOLVED:** live key; Haiku-class code model; vendor claims to be re-measured in Phase 1.
2. Which starting point do we guarantee for the demo (scratch template, repo, or existing website)? **ANSWERED (grill): generic, highly-editable template site; repo/url visible but non-demo.**
3. Name and brand for the product? **Placeholder until hour 18.**
4. *(New)* Unlimited-retry policy on failed builds — cap it or accept the churn risk? Must be resolved before code freeze.