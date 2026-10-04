/* Ground truth: Figma "gaze / Upload source chooser" (1280×832), Flow 3.
   Heading 40px at x112 y232, description 18px y294, back link y157,
   two 336×288 cards on a 696 backplate at y365, supporting note centered
   y702. Interactive board is a client island; the frame shell stays a
   server component. */
import ScaleStage from "../stage";
import SiteHeader from "../components/site-header";
import BackLink from "../components/back-link";
import ImportBoard from "./board";

export default function ImportPage() {
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
          <BackLink href="/new" label="Back to starting points" />
        </div>

        {/* intro: x112 y232 */}
        <div className="absolute left-[112px] top-[232px] w-[1056px]">
          <h1 className="text-[40px] font-normal leading-[52px] tracking-[-1.2px] text-[#f5f7f7]">
            Bring your project to gaze.
          </h1>
          <p className="mt-[8px] text-[18px] font-normal leading-[26px] text-[#c5cad3]">
            Choose where your existing project lives. We&rsquo;ll take it from there.
          </p>
        </div>

        {/* cards: two 336×288, y365 (Hifi carries no backplate here) */}
        <section aria-label="Upload sources" className="absolute left-[292px] top-[365px] h-[288px] w-[696px]">
          <ImportBoard />
        </section>

        {/* supporting note: centered, y702 */}
        <p className="absolute left-[300px] top-[702px] w-[680px] text-center text-[16px] font-normal leading-[23px] text-[#f5f7f7]">
          Keep your code. Give it a new way to grow.
        </p>
      </ScaleStage>
    </main>
  );
}
