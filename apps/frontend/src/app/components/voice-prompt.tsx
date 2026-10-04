'use client';

/* Voice-to-project island (Task 2): browser speech recognition streams the
 *  transcript into the Figma Textbox states (default → atOrUnderSix →
 *  overSix past ~6 lines, tail-pinned); 4.5s of silence locks + submits the
 *  brief to POST /api/projects/generate, then routes to /{project}. Mic/type
 *  toggle or no-mic browsers fall back to a typed pill with the same
 *  geometry. Generating/error chrome lives in the dead strip below the
 *  panel (y800–832) — the Figma geometry above is untouched. */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { IdeaPrompt, PILL_OUTER_CLASS, PILL_TAB_CLASS, promptStateFor } from "./idea-prompt";
import { generateProject } from "../lib/projects";
import { projectHref } from "../project-url";

const SILENCE_MS = 4500;

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

export default function VoicePrompt() {
  const router = useRouter();
  const asrAvailable = useSyncExternalStore(subscribeAsr, getAsrSnapshot, getAsrServerSnapshot);
  const [denied, setDenied] = useState(false);
  const [forceTyped, setForceTyped] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [status, setStatus] = useState<Status>("listening");
  const [failure, setFailure] = useState("");
  const [draft, setDraft] = useState("");
  const recognition = useRef<Recognition | null>(null);
  const phase = useRef<Status>("listening");
  const textRef = useRef("");
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const useTypedFallback = forceTyped || !asrAvailable || denied;

  /** Single phase transition (ref + state stay together). */
  const setPhase = useCallback((next: Status) => {
    phase.current = next;
    setStatus(next);
  }, []);

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
      setPhase("generating");
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
        setPhase("error");
        setFailure(err instanceof Error ? err.message : "Generation failed.");
      }
    },
    [clearSilenceTimer, router, setPhase],
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
      setPhase("error");
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
  }, [asrAvailable, setPhase]);

  const startListening = useCallback(() => {
    const rec = recognition.current;
    if (!rec) return;
    setPhase("listening");
    setFailure("");
    try {
      rec.start();
    } catch {
      // Already running — interim results will flow.
    }
  }, [setPhase]);

  const retry = useCallback(() => {
    if (textRef.current.trim().length >= 3) {
      void submit(textRef.current);
    } else {
      textRef.current = "";
      setTranscript("");
      setPhase("listening");
      setFailure("");
      startListening();
    }
  }, [startListening, submit, setPhase]);

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
  const displayTranscript = transcript;
  const state = promptStateFor(displayTranscript);

  return (
    <>
      {status === "listening" && useTypedFallback ? (
        <section aria-label="Voice prompt" className="absolute left-[490px] top-[729px] h-[65px] w-[300px]">
          <div className={PILL_OUTER_CLASS}>
            <div className={PILL_TAB_CLASS}>
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
          <IdeaPrompt state={state} transcript={displayTranscript} />
          {!useTypedFallback && state === "default" && status === "listening" && (
            <button
              type="button"
              onClick={startListening}
              aria-label="Start speaking your idea"
              className="absolute left-[490px] top-[729px] h-[65px] w-[300px] cursor-pointer rounded-[32px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/60"
            />
          )}
        </>
      )}
      {/* Mic/type toggle lives in the dead strip below the pill (y800) —
          the Figma pill/panel geometry above is untouched. */}
      {state === "default" && status === "listening" && (
        <div className="absolute left-[490px] top-[800px] w-[300px] text-center">
          {useTypedFallback ? (
            asrAvailable && !denied ? (
              <button
                type="button"
                onClick={() => {
                  setForceTyped(false);
                  startListening();
                }}
                className="text-[12px] font-normal leading-4 text-[#c5cad3]/70 underline underline-offset-2 transition-opacity hover:opacity-75"
              >
                Use mic instead
              </button>
            ) : (
              <p className="text-[12px] font-normal leading-4 text-[#c5cad3]/50">
                Mic unavailable in this browser
              </p>
            )
          ) : (
            <button
              type="button"
              onClick={() => setForceTyped(true)}
              className="text-[12px] font-normal leading-4 text-[#c5cad3]/70 underline underline-offset-2 transition-opacity hover:opacity-75"
            >
              Type instead
            </button>
          )}
        </div>
      )}
      {(status === "generating" || status === "error") && (
        <div aria-live="polite" className="absolute left-[340px] top-[800px] w-[600px] text-center">
          {status === "generating" ? (
            <p className="flex items-center justify-center gap-2 text-[13px] font-normal leading-5 text-[#c5cad3]">
              <span
                aria-hidden
                className="animate-spin h-[14px] w-[14px] rounded-full border-2 border-white/15 border-t-[#6fd6d1]"
              />
              <span className="animate-ring-pulse">Building your first version…</span>
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
