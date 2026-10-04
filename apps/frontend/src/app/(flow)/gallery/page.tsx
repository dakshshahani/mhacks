/* Ground truth: Figma "gaze / Project gallery" (1280×832), Flow 3 HIFI.
   Heading "Welcome to gaz[e-mark]" 40px at x112 y125 (logo mark inline),
   description 18px y185. Search x56 y246. Grid x56 y328: 2×4 cards
   273×191. Footer y770: count + pagination pill. First card creates.
   Shell (stage, grid, fade, header) lives in (flow)/layout — this is the
   animated content only. */
import { LogoMark } from "../../components/site-header";
import GalleryBoard from "./board";

export default function GalleryPage() {
  return (
    <>
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
    </>
  );
}
