/* Ground truth: Figma "gaze / Method chooser" (1280×832), Flow 3, minus the
   deleted "Start from online website" card. Remaining two cards keep their
   336×288 size; the backplate shrinks 1056→696 and the pair recenters
   (x292), mirroring the two-card upload chooser. Heading 40px at x112 y232,
   description 18px y294, back link y157, supporting note centered y702.
   Backdrop is the aurora Vector 1 (340:4263): 902×692 at x167 y133.
   Shell (stage, grid, fade, header) lives in (flow)/layout — this is the
   animated content only. */
import { Plus, Upload } from "lucide-react";
import AuroraBackdrop from "../../components/aurora";
import BackLink from "../../components/back-link";
import OptionCard from "../../components/option-card";

export default function NewProjectPage() {
  return (
    <>
      {/* aurora: 902×692 at x167 y133, behind the cards (over the fade so the crown stays lit) */}
      <AuroraBackdrop />

      {/* back: x112 y157 */}
      <div className="absolute left-[112px] top-[157px]">
        <BackLink href="/gallery" label="Back to projects" />
      </div>

      {/* intro: x112 y232 */}
      <div className="absolute left-[112px] top-[232px] w-[1056px]">
        <h1 className="text-[40px] font-normal leading-[52px] tracking-[-1.2px] text-[#f5f7f7]">
          How would you like to start?
        </h1>
        <p className="mt-[8px] text-[18px] font-normal leading-[26px] text-[#c5cad3]">
          Every idea starts somewhere. Choose your starting point.
        </p>
      </div>

      {/* cards: two 336×288, y365 (Hifi carries no backplate here) */}
      <section aria-label="Starting points" className="absolute left-[292px] top-[365px] h-[288px] w-[696px]">
        <div className="absolute inset-0 flex gap-[24px]">
          <OptionCard
            href="/"
            icon={<Plus size={24} aria-hidden />}
            title="Start new project"
            description="Turn an idea into a first version. Just describe what you have in mind."
            cta="Start creating"
          />
          <OptionCard
            href="/import"
            icon={<Upload size={24} aria-hidden />}
            title="Upload existing project"
            description="Bring your own code and keep building with gaze."
            cta="Choose a source"
          />
        </div>
      </section>

      {/* supporting note: centered, y702 */}
      <p className="absolute left-[300px] top-[702px] w-[680px] text-center text-[16px] font-normal leading-[23px] text-[#f5f7f7]">
        Your next project, built with your eyes and your voice.
      </p>
    </>
  );
}
