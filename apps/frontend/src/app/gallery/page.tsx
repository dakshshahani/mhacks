/* Ground truth: Figma "gaze / Project gallery" (1280×832), Flow 3.
   Frame bg #0A0A0A · blueprint grid · 220px header fade · shared header.
   Intro: "Welcome to gaze." Jost 40px at x112 y163; description 18px y223.
   Gallery backplate x110 y281 1060×424; actions bar y740 (count 15px +
   "+ Create new" 18px → /new). Tile sub-line (path · edited) is the voted
   delta over the frame's name-only tile. Interactive board is a client
   island; the frame shell stays a server component. */
import ScaleStage from "../stage";
import SiteHeader from "../components/site-header";
import GalleryBoard from "./board";

export default function GalleryPage() {
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

        {/* intro: x112 y163 */}
        <div className="absolute left-[112px] top-[163px] w-[1056px]">
          <h1 className="text-[40px] font-normal leading-[52px] tracking-[-1.2px] text-[#f5f7f7]">
            Welcome to gaze.
          </h1>
          <p className="mt-[8px] text-[18px] font-normal leading-[26px] text-[#c5cad3]">
            Pick up where you left off, or bring a new idea to life.
          </p>
        </div>

        <GalleryBoard />
      </ScaleStage>
    </main>
  );
}
