// Figma Textbox set 288:9158 (Flow 1: New state landing). Display-only panel:
// the voice island drives `state` from live speech, Task 2 submit on silence.
// Geometry is ground truth — do not restyle (see page.tsx header comment).

export type PromptState = "default" | "atOrUnderSix" | "overSix";

/** Shared pill chrome (default pill + typed fallback render identically). */
export const PILL_OUTER_CLASS =
  "h-full w-full rounded-[32px] bg-gradient-to-b from-[#666666]/40 via-[#1d1d1d]/90 to-[#1d1d1d] p-3 shadow-[inset_0_1px_1px_rgba(255,255,255,0.5),inset_0_0_22px_rgba(255,255,255,0.12)] backdrop-blur-[40px]";
export const PILL_TAB_CLASS =
  "flex h-[41px] items-center rounded-[20px] bg-white/[0.31] px-[35px] mix-blend-screen backdrop-blur-[40px]";

/** Figma Textbox rule: the 500px text box at Jost 16/24 shows ~6 lines
 *  (168px Tab). Past that the variant flips to overSix and only the tail
 *  is shown with a "…" prefix — exactly like the Figma variant text. */
const CHARS_PER_LINE = 55;
const VISIBLE_LINES = 6;
const TAIL_CHARS = VISIBLE_LINES * CHARS_PER_LINE;

export function promptStateFor(transcript: string): PromptState {
  const text = transcript.trim();
  if (text.length === 0) return "default";
  return text.length > TAIL_CHARS ? "overSix" : "atOrUnderSix";
}

export function tailText(transcript: string): string {
  const text = transcript.trim();
  return text.length > TAIL_CHARS ? `…${text.slice(-TAIL_CHARS)}` : text;
}

export function IdeaPrompt({
  state = "default",
  transcript = "",
}: {
  state?: PromptState;
  transcript?: string;
}) {
  if (state === "default") {
    return (
      <section aria-label="Voice prompt" className="absolute left-[490px] top-[729px] h-[65px] w-[300px]">
        <div className={PILL_OUTER_CLASS}>
          <div className={`${PILL_TAB_CLASS} justify-center`}>
            <p className="text-center text-[16px] font-normal leading-6 text-[#f5f7f7]">
              Look here. Start speaking
            </p>
          </div>
        </div>
      </section>
    );
  }
  const text =
    transcript ||
    "Start talking: describe your idea and we'll build the first version.";
  const shown = state === "overSix" && transcript ? tailText(transcript) : text;
  return (
    <section aria-label="Voice prompt" aria-live="polite" className="absolute left-[340px] top-[600px] h-[197px] w-[600px]">
      <div className="h-full w-full rounded-[32px] bg-gradient-to-b from-[#666666]/40 via-[#1d1d1d]/90 to-[#1d1d1d] p-[15px] shadow-[inset_0_1px_1px_rgba(255,255,255,0.5),inset_0_0_22px_rgba(255,255,255,0.12)] backdrop-blur-[40px]">
        <div className="h-[168px] overflow-hidden rounded-[20px] bg-white/[0.31] px-[35px] py-[15px] mix-blend-screen backdrop-blur-[40px]">
          <p className="text-[16px] font-normal leading-6 text-[#f5f7f7]">
            {shown}
          </p>
        </div>
      </div>
    </section>
  );
}
