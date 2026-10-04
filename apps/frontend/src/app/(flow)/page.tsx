/* Ground truth: Figma "Flow 1: New state landing" (1280×832), pulled via REST.
   Landing/1 default (14:1316): frame bg #0A0A0A · ink #F5F7F7 · muted #C5CAD3 ·
   wordmark Jost Italic 72 · tagline Jost Italic 25px ls -1.25. Orbit ring
   411px at x434 y373; orb 315px centered (639.5, 578.5). Textbox/speech panel coordinates
   remain in the shared ScaleStage from (flow)/layout. The shared shell and
   navbar are outside this page's route transition. */
import Orb from "../components/hero-orb";
import VoicePrompt from "../components/voice-prompt";

/** Orbit ring — 411px, teal (left) → near-white (right) gradient stroke. */
function OrbitRing() {
  return (
    <svg
      aria-hidden
      className="animate-ring-pulse block h-[411px] w-[411px]"
      viewBox="0 0 411 411"
      fill="none"
    >
      <defs>
        <linearGradient id="orbit" x1="0" y1="0" x2="411" y2="120">
          <stop offset="0" stopColor="#6fd6d1" />
          <stop offset="0.45" stopColor="#c5cad3" />
          <stop offset="1" stopColor="#f2f3fa" />
        </linearGradient>
      </defs>
      <circle cx="205.5" cy="205.5" r="205" stroke="url(#orbit)" strokeWidth="1.25" />
    </svg>
  );
}

export default function Home() {
  return (
    <>
      {/* wordmark: full-logo vectors x566 y198, 148×56 */}
      <div className="absolute left-1/2 top-[181px] -translate-x-1/2">
        <div className="relative">
          <div aria-hidden className="absolute left-1/2 top-1/2 h-[99px] w-[251px] -translate-x-1/2 -translate-y-1/2 bg-[#f2f2fa]/50 blur-[100px]" />
          <h1 className="relative">
            <img
              src="/gaze-full.svg"
              alt="gaze"
              width={150}
              height={56}
              className="h-[56px] w-auto"
            />
          </h1>
        </div>
      </div>

      {/* tagline: x405 y294, 470×36 · orbit clears it by 43px (y373) */}
      <p className="absolute left-[405px] top-[294px] h-9 w-[470px] text-center text-[25px] italic leading-9 text-[#c5cad3] [letter-spacing:-1.25px]">
        Point with your eyes, direct with your voice.
      </p>

      {/* orbit: x434 y373, 411×411; orb centered on (639.5, 578.5) */}
      <div className="absolute left-[434px] top-[373px] h-[411px] w-[411px]" aria-hidden>
        <OrbitRing />
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <Orb />
        </div>
      </div>

      <VoicePrompt />
    </>
  );
}
