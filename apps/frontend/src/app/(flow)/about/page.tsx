/* About: the landing hero orb on the left, the story on the right.
   Copy is drawn from docs/PRD.md §1 (overview + one-line pitch).
   Shell (stage, grid, fade, header) lives in (flow)/layout — this is the
   animated content only. */
import { Heart } from "lucide-react";
import Orb from "../../components/hero-orb";

export default function AboutPage() {
  return (
    <>
      {/* orb: 315px, left column */}
      <div className="absolute left-[140px] top-[258px]" aria-hidden>
        <Orb />
      </div>

      {/* story: right column */}
      <div className="absolute left-[540px] top-[258px] w-[600px]">
        <h1 className="text-[40px] font-normal leading-[52px] tracking-[-1.2px] text-[#f5f7f7]">
          About gaze
        </h1>
        <p className="mt-[16px] text-[18px] font-normal leading-[30px] text-[#c5cad3]">
          gaze is a developer tool for building frontend interfaces by looking
          at an element and talking about it. Eye tracking figures out which
          component you mean, speech-to-text captures the instruction, and an
          agentic backend edits the code and live-reloads the result — look at
          the navbar and say &ldquo;make this sticky,&rdquo; and the preview
          updates. Under the hood, a fast decision model works out intent,
          target, and risk on every utterance, and a code-generating model
          writes the edit only when needed.
        </p>
        <p className="mt-[16px] text-[20px] font-normal italic leading-[28px] text-[#f5f7f7]">
          Cursor, but you point with your eyes and direct with your voice.
        </p>
      </div>

      {/* credits footer */}
      <p className="absolute left-[300px] top-[760px] flex w-[680px] items-center justify-center gap-[8px] text-center text-[15px] font-normal leading-[22px] text-[#c5cad3]">
        Made with
        <Heart size={15} aria-label="love" className="text-[#f5f7f7]" />
        by Corbin, Daksh, Anna &amp; Anthony
      </p>
    </>
  );
}
