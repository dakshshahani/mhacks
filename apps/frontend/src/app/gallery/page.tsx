/* Ground truth: Figma "gaze / Project gallery" (1280×832), Flow 3 HIFI.
   Heading "Welcome to gaz[e-mark]" 40px at x112 y125 (logo mark inline),
   description 18px y185. Search x56 y246. Grid x56 y328: 2×4 cards
   273×191. Footer y770: count + pagination pill. First card creates. */
import ScaleStage from "../stage";
import SiteHeader, { LogoMark } from "../components/site-header";
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

        {/* intro: x112 y125, logo mark inline after "gaz" */}
        <div className="absolute left-[112px] top-[125px] w-[1056px]">
          <h1 className="flex items-center gap-[2px] text-[40px] font-normal leading-[52px] tracking-[-1.2px] text-[#f5f7f7]">
            Welcome to gaz
            <LogoMark className="h-[36px]" />
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
