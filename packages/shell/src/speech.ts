// Dev C: STT plumbing behind `speech:*` (team cut TTS — STT only).
// Shell owns the mic stream; emits speech:transcript {text,isFinal} +
// speech:state off|listening|processing. STT = Web Speech primary /
// ElevenLabs Scribe fallback.

import type { SpeechEvent, SpeechState } from "@mhacks/contracts";

export type RecognizerKind = "web-speech" | "scribe";

export interface Recognizer {
  kind: RecognizerKind;
  isAvailable(): boolean;
}

/** Disclosure rule (grill-locked): mic chip shows the sponsor trial badge. */
export const SPEECH_SPONSOR: string = "elevenlabs-trial";

export class SpeechService {
  private state: SpeechState = "off";
  private streamId: string | null = null;
  private counter = 0;
  private lastTranscript: SpeechEvent | null = null;
  private stateListeners = new Set<(s: SpeechState) => void>();
  private transcriptListeners = new Set<(e: SpeechEvent) => void>();
  private readonly recognizers: Recognizer[];

  constructor(recognizers: Recognizer[] = []) {
    this.recognizers = recognizers;
  }

  get currentState(): SpeechState {
    return this.state;
  }

  get activeKind(): RecognizerKind | null {
    const avail = this.recognizers.find((r) => r.isAvailable());
    return avail ? avail.kind : null;
  }

  onState(fn: (s: SpeechState) => void): () => void {
    this.stateListeners.add(fn);
    return () => {
      this.stateListeners.delete(fn);
    };
  }

  onTranscript(fn: (e: SpeechEvent) => void): () => void {
    this.transcriptListeners.add(fn);
    return () => {
      this.transcriptListeners.delete(fn);
    };
  }

  private emitState(s: SpeechState): void {
    this.state = s;
    for (const fn of this.stateListeners) fn(s);
  }

  /** speech:start — hotkey toggle. listening is also Dev A's lock-on signal. */
  start(): { ok: true; streamId: string } | { ok: false; message: string } {
    if (this.state === "listening") return { ok: true, streamId: this.streamId ?? "s-0" };
    if (!this.activeKind) return { ok: false, message: "no recognizer available" };
    this.counter += 1;
    this.streamId = `s-${this.counter}`;
    this.emitState("listening");
    return { ok: true, streamId: this.streamId };
  }

  /** Interim/final tokens from the recognizer. Final flips to processing. */
  pushTranscript(text: string, isFinal: boolean): void {
    if (this.state !== "listening" && this.state !== "processing") return;
    const evt: SpeechEvent = { text, isFinal };
    // Final transcript emits once: ignore duplicates after processing started
    // with the same text (mic echo guard).
    if (isFinal && this.lastTranscript?.isFinal && this.lastTranscript.text === text) return;
    this.lastTranscript = evt;
    for (const fn of this.transcriptListeners) fn(evt);
    if (isFinal) this.emitState("processing");
  }

  stop(): void {
    this.streamId = null;
    this.emitState("off");
  }

  resetToIdle(): void {
    this.emitState("off");
  }
}
