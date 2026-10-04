'use client';

/* Voice-to-project island (Task 2): browser speech recognition streams the
 *  transcript into the Figma Textbox states (default → atOrUnderSix →
 *  overSix past ~6 words); 4.5s of silence locks + submits the brief to
 *  POST /api/projects/generate, then routes to /{project}. No mic (denied
 *  or unsupported) falls back to a typed pill with the same geometry.
 *  Generating/error chrome lives in the dead strip below the panel
 *  (y800–832) — the Figma geometry above is untouched. */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { IdeaPrompt, type PromptState } from "./idea-prompt";
import { generateProject } from "../lib/projects";
import { projectHref } from "../project-url";

const SILENCE_MS = 4500;
const OVER_SIX_WORDS = 6;

type Status = "listening" | "generating" | "error";

interface RecognitionResult {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string };
}
interface RecognitionEvent {
  readonly resultIndex: number;
  readonly results: ReadonlyArray<RecognitionResult>;
}
interface RecognitionErrorEvent {
  readonly error: string;
}
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  const ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (typeof ctor !== "function") return null;
  return ctor as RecognitionCtor;
}

/* ASR capability is client-only: SSR snapshot says unavailable (typed pill),
 * hydration re-reads without mismatch (same useSyncExternalStore pattern as
 * the gallery selection in lib/projects.ts). */
function subscribeAsr(): () => void {
  return () => {};
}
function getAsrSnapshot(): boolean {
  return recognitionCtor() !== null;
}
function getAsrServerSnapshot(): boolean {
  return false;
}

function wordCount(text: string): number {
  const n = text.trim().split(/\s+/).filter(Boolean).length;
  return Number.isFinite(n) ? n : 0;
}

function stateFor(transcript: string): PromptState {
  if (transcript.trim().length === 0) return "default";
  return wordCount(transcript) > OVER_SIX_WORDS ? "overSix" : "atOrUnderSix";
}

export default function VoicePrompt() {
  const router = useRouter();
  const asrAvailable = useSyncExternalStore(subscribeAsr, getAsrSnapshot, getAsrServerSnapshot);
  const [denied, setDenied] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [status, setStatus] = useState<Status>("listening");
  const [failure, setFailure] = useState("");
  const [draft, setDraft] = useState("");
  const recognition = useRef<Recognition | null>(null);
  const phase = useRef<Status>("listening");
  const textRef = useRef("");
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typed = !asrAvailable || denied;

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimer.current !== null) {
      clearTimeout(silenceTimer.current);
      silenceTimer.current = null;
    }
  }, []);

  const submit = useCallback(
    async (brief: string) => {
      const text = brief.trim();
      if (text.length < 3 || phase.current === "generating") return;
      phase.current = "generating";
      setStatus("generating");
      setFailure("");
      clearSilenceTimer();
      try {
        recognition.current?.stop();
      } catch {
        // Already stopped.
      }
      try {
        const active = await generateProject(text);
        router.push(projectHref(active.name, active.previewUrl));
      } catch (err) {
        phase.current = "error";
        setStatus("error");
        setFailure(err instanceof Error ? err.message : "Generation failed.");
      }
    },
    [clearSilenceTimer, router],
  );

  // Silence gate: every transcript update restarts the 4.5s clock.
  useEffect(() => {
    if (phase.current !== "listening" || textRef.current.trim().length === 0) return;
    clearSilenceTimer();
    const snapshot = textRef.current;
    silenceTimer.current = setTimeout(() => {
      void submit(snapshot);
    }, SILENCE_MS);
    return clearSilenceTimer;
  }, [transcript, clearSilenceTimer, submit]);

  // Voice lifecycle. Chrome ends recognition on long pauses — restart while
  // still listening with nothing to submit yet. All state writes here happen
  // in async recognizer callbacks, never synchronously in the effect body.
  useEffect(() => {
    if (!asrAvailable) return;
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    let rec: Recognition | null = null;
    try {
      rec = new Ctor();
    } catch {
      return;
    }
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (event) => {
      if (phase.current !== "listening") return;
      let combined = "";
      for (const result of event.results) combined += result[0]?.transcript ?? "";
      textRef.current = combined;
      setTranscript(combined);
    };
    rec.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setDenied(true);
        return;
      }
      if (phase.current !== "listening") return;
      phase.current = "error";
      setStatus("error");
      setFailure("The microphone cut out — retry to keep speaking, or type instead.");
    };
    rec.onend = () => {
      if (phase.current === "listening" && textRef.current.trim().length === 0) {
        try {
          rec?.start();
        } catch {
          // Already running or blocked — the error handler covers it.
        }
      }
    };
    recognition.current = rec;
    try {
      rec.start();
    } catch {
      // Blocked until a user gesture: the pill overlay below starts it.
    }
    return () => {
      recognition.current = null;
      try {
        rec?.stop();
      } catch {
        // Already stopped.
      }
    };
  }, [asrAvailable]);

  const startListening = useCallback(() => {
    const rec = recognition.current;
    if (!rec) return;
    phase.current = "listening";
    setStatus("listening");
    setFailure("");
    try {
      rec.start();
    } catch {
      // Already running — interim results will flow.
    }
  }, []);

  const retry = useCallback(() => {
    if (textRef.current.trim().length >= 3) {
      void submit(textRef.current);
    } else {
      textRef.current = "";
      setTranscript("");
      phase.current = "listening";
      setStatus("listening");
      setFailure("");
      startListening();
    }
  }, [startListening, submit]);

  const submitTyped = useCallback(() => {
    const text = draft.trim();
    if (text.length < 3 || phase.current === "generating") return;
    textRef.current = text;
    setTranscript(text);
    void submit(text);
  }, [draft, submit]);

  // `transcript` state mirrors textRef on every update, so render reads state
  // only (refs stay in callbacks/effects). During generating/error the last
  // transcript stays frozen on screen by construction — nothing clears it.
  const frozen = transcript;
  const state = stateFor(frozen);

  return (
    <>
      {typed ? (
        <section aria-label="Voice prompt" className="absolute left-[490px] top-[729px] h-[65px] w-[300px]">
          <div className="h-full w-full rounded-[32px] bg-gradient-to-b from-[#666666]/40 via-[#1d1d1d]/90 to-[#1d1d1d] p-3 shadow-[inset_0_1px_1px_rgba(255,255,255,0.5),inset_0_0_22px_rgba(255,255,255,0.12)] backdrop-blur-[40px]">
            <div className="flex h-[41px] items-center rounded-[20px] bg-white/[0.31] px-[35px] mix-blend-screen backdrop-blur-[40px]">
              <label htmlFor="typed-brief" className="sr-only">
                Type your idea
              </label>
              <input
                id="typed-brief"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitTyped();
                }}
                placeholder="Type your idea, Enter to build…"
                autoFocus
                className="w-full bg-transparent text-[16px] font-normal leading-6 text-[#f5f7f7] outline-none placeholder:text-[#f5f7f7]/70"
              />
            </div>
          </div>
        </section>
      ) : (
        <>
          <IdeaPrompt state={state} transcript={frozen} />
          {state === "default" && status === "listening" && (
            <button
              type="button"
              onClick={startListening}
              aria-label="Start speaking your idea"
              className="absolute left-[490px] top-[729px] h-[65px] w-[300px] cursor-pointer rounded-[32px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/60"
            />
          )}
        </>
      )}
      {(status === "generating" || status === "error") && (
        <div aria-live="polite" className="absolute left-[340px] top-[800px] w-[600px] text-center">
          {status === "generating" ? (
            <p className="animate-ring-pulse text-[13px] font-normal leading-5 text-[#c5cad3]">
              Building your first version…
            </p>
          ) : (
            <p className="text-[13px] font-normal leading-5 text-[#ffb3bd]">
              {failure}{" "}
              <button
                type="button"
                onClick={retry}
                className="underline underline-offset-2 transition-opacity hover:opacity-75"
              >
                Retry
              </button>
            </p>
          )}
        </div>
      )}
    </>
  );
}
