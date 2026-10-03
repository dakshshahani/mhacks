# Grill Results — Decisions Log (all answers explicit, nothing implied)

Interview evidence for AGENTS.md. Answers override the PRD wherever they
conflict.

## Facts locked in

| Question | Answer |
| --- | --- |
| Hackathon length | **24 hours** (PRD phases now map: 4.8h / 9.6h / 6h / 3.6h) |
| Jev key | **Working today** — probe ran 6 real decisions against `api.typesafe.ai` |
| Team | 3 devs (A/B/C) + 1 PM/Designer/FE with minimal code experience |
| Speech engine | **ElevenLabs (sponsor)** — used for the demo; PRD header's "no sponsor credits" is **void** |
| Pricing/landing | **Everything mocked in 24h** — pricing cards + local token counter; no Stripe, no webhooks |
| Product name | Placeholder until hour 18 |
| Demo target | **A deliberately generic, highly-editable site** (easy for Jev to command + Haiku to edit); open-repo/URL stay visible in UI as non-demo paths |
| Priority | Core loop working on the demo site + PM-designed clean UI; landing page kept short |
| Eye tracking | **WebGazer.js — tested on a team laptop** (PRD's 100–200px is still vendor-adjacent; measure our own in the spike) |
| Shell | **React project; Electron wrap only if it doesn't threaten the core loop** |
| Code-editing model | **Haiku-class small model** (small route) |
| Apply UX | **Auto-apply every edit. No Confirm dialogs.** A 5-second undo circle appears; **look at it with ~500ms dwell → undo; click also undoes** |
| Import site/URL | **Cut entirely from the demo.** Options stay in the UI but route to "not yet" states |
| Landing page build | Designed in Figma, then **vibecoded inside our own app by the PM** (dogfooding showcase) |
| Edit retry policy | **User chose "unlimited retries"** — see objection below |

## Architecture deltas from the answers

1. **Undo circle replaces risk-gated Confirm.** `EditRequest.riskScore` and
   `POLICY.APPLY_THRESHOLD` stop gating a *dialog* — they now gate the undo
   window *duration* (risky edit → longer/bigger circle). Contracts updated:
   `PendingAction` is now `"undo-window" | null`.
2. **Shell is React-first.** `apps/desktop` is scaffolded as React; Electron
   main-process code (git service, IPC) hides behind the `ipc.ts` contract so
   the wrap is additive, not a rewrite. If Electron isn't DONE by the G3
   gate, the demo runs in the browser harness.
3. **The demo's "wow" is dogfooded landing.** But it is *sequenced after* the
   core loop: the landing vibecoding only happens if the core loop passed its
   gates. If it hasn't, landing falls back to static Figma export.

## Open objections (griller's notes — resolve explicitly or eat them)

1. **Unlimited retries is a demo-killer as stated.** An LLM that can't pass a
   build gate will not converge by iteration 7 — it churns tokens and stalls
   the pipeline in front of judges. Counterproposal: retry with build-error
   context appended, cap 3, then revert to pre-edit state and show a
   "couldn't apply" card. "Unlimited" only for the *user-invoked* retry.
2. **Dogfooded landing is gated on the product working.** That's intentional
   showmanship, but the fallback (static Figma export) must exist by hour 20.
3. **Import cut entirely** — update the demo script: never show the import
   button on stage; show at most the "not yet" state when asked.
4. **Sponsor budget**: using ElevenLabs credits for the demo while pitching
   paid tiers means the demo must be honest on the起 mic badge (show it's a
   sponsor trial) — judges punish hidden sponsorship.
