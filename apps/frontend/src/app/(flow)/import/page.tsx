/* Ground truth: Figma "gaze / Upload source chooser" (1280×832), Flow 3.
   Heading 40px at x112 y232, description 18px y294, back link y157,
   two 336×288 cards on a 696 backplate at y365, supporting note centered
   y702. Backdrop shares the Method chooser aurora (Vector 1, 340:3858:
   902×692 at x167 y133). Interactive board is a client island; the frame
   shell stays a server component. Shell (stage, grid, fade, header) lives
   in (flow)/layout — this is the animated content only. */
import AuroraBackdrop from "../../components/aurora";
import BackLink from "../../components/back-link";
import ImportBoard from "./board";

export default function ImportPage() {
  return (
    <>
      {/* aurora: 902×692 at x167 y133, behind the cards (over the fade so the crown stays lit) */}
      <AuroraBackdrop />

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
    </>
  );
}
