/* Ground truth: Figma "gaze / Method chooser" (1280×832), Flow 3, minus the
   deleted "Start from online website" card. Remaining two cards keep their
   336×288 size; the backplate shrinks 1056→696 and the pair recenters
   (x292), mirroring the two-card upload chooser. Heading 40px at x112 y232,
   description 18px y294, back link y157, supporting note centered y702. */
import { Plus, Upload } from "lucide-react";
import ScaleStage from "../stage";
import SiteHeader from "../components/site-header";
import BackLink from "../components/back-link";
import OptionCard from "../components/option-card";

export default function NewProjectPage() {
  return (
    <main className="min-h-dvh bg-[#0a0a0a] text-white">
      <ScaleStage>
        {/* blueprint grid */}
        <div aria-hidden className="bg-blueprint-grid pointer-events-none absolute inset-0" />
        {/* header fade: 220px #0A0A0A@0.94 → transparent */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[220px] bg-gradient-to-b from-[#0a0a0a]/95 to-transparent"
        />
        <SiteHeader />

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
              href="/edit"
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
      </ScaleStage>
    </main>
  );
}
