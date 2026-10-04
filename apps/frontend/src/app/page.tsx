/* Ground truth: Figma "Flow 1: New state landing" (1280×832), pulled via REST.
   Landing/1 default (14:1316): frame bg #0A0A0A · ink #F5F7F7 · muted #C5CAD3 ·
   wordmark Jost Italic 72 · tagline Jost Italic 25px ls -1.25 · nav Jost 20px.
   Orbit ring 411px at x434 y373; orb 315px centered (639.5, 578.5); ring mark
   is the dark-glass Profile Target w/ gradient "e" at 3 o'clock (x802 y539).
   Textbox set 288:9158: default pill 300×65 p12 r32 at x490 y729 reading
   "Look here. Start speaking"; speaking panel 600×197 p15 r32 at x340 y600
   (atOrUnderSix: transcript from start · overSix: tail pinned w/ "…").
   Tab inner: white 31% screen, r20, Jost 16/24. All geometry absolutely
   positioned in frame coordinates; ScaleStage width-fits the frame. */
import Link from "next/link";
import ScaleStage from "./stage";
import VoicePrompt from "./components/voice-prompt";

function LogoMark() {
  return (
    <span
      aria-hidden
      className="inline-block -mr-[0.12em] pr-[0.12em] text-[34px] italic leading-none text-transparent"
      style={{
        backgroundImage: "radial-gradient(circle at 50% 50%, #4a58bf, #4cbbc1)",
        backgroundClip: "text",
        WebkitBackgroundClip: "text",
      }}
    >
      e
    </span>
  );
}

function UserIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#f5f7f7"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

/** Ring mark — Figma Profile Target on the orbit (86×88 dark glass + gradient
 *  "e"). Sits at 3 o'clock on the ring; positioned by the caller. */
function OrbitMark() {
  return (
    <div className="flex h-[88px] w-[86px] items-center justify-center rounded-full bg-[#1d1d1d]/80 shadow-[inset_0_1px_1px_rgba(255,255,255,0.5),inset_0_0_22px_rgba(255,255,255,0.12)] backdrop-blur-[40px]">
      <LogoMark />
    </div>
  );
}

/** Marbled orb — periwinkle base, teal streaks, deep-blue patches, white
 *  swirls. Figma source is an animated code-component gradient; this
 *  approximates one frame with morphing metaballs. */
function Orb() {
  return (
    <div className="animate-orb-breathe relative h-[315px] w-[315px] overflow-hidden rounded-full bg-[#a9abdd]">
      <div className="animate-orb-spin absolute -inset-8">
        <div className="animate-orb-a absolute left-[6%] top-[4%] h-[46%] w-[44%] rounded-full bg-[#2a28b8] blur-md" />
        <div className="animate-orb-b absolute bottom-[4%] right-[6%] h-[52%] w-[48%] rounded-full bg-[#2e2cc2] blur-md" />
        <div className="animate-orb-c absolute left-[26%] top-[24%] h-[44%] w-[44%] rounded-full bg-[#4a58bf] blur-md" />
        <div className="animate-orb-b absolute left-[4%] top-[44%] h-[32%] w-[30%] rounded-full bg-[#2323a8] blur-md" />
        <div className="animate-orb-a absolute right-[8%] top-[30%] h-[30%] w-[34%] rounded-full bg-[#57c6c0] blur-md" />
        <div className="animate-orb-c absolute bottom-[34%] left-[16%] h-[13%] w-[48%] rounded-full bg-[#f2f3fa] blur-lg" />
        <div
          className="animate-orb-a absolute bottom-[16%] right-[14%] h-[11%] w-[40%] rounded-full bg-[#eef0fa] blur-lg"
          style={{ animationDelay: "-6s" }}
        />
        <div
          className="animate-orb-a absolute left-[42%] top-[6%] h-[30%] w-[26%] rounded-full bg-[#7c7fd0] blur-md"
          style={{ animationDelay: "-6s" }}
        />
        <div
          className="animate-orb-b absolute bottom-[30%] right-[30%] h-[22%] w-[26%] rounded-full bg-[#8fd6d4] blur-md"
          style={{ animationDelay: "-11s" }}
        />
        <div
          className="animate-orb-c absolute left-[10%] top-[16%] h-[24%] w-[22%] rounded-full bg-[#57c6c0] blur-lg"
          style={{ animationDelay: "-4s" }}
        />
      </div>
      <div className="absolute inset-0 rounded-full shadow-[inset_-16px_-22px_55px_rgba(20,20,90,0.4),inset_12px_16px_45px_rgba(255,255,255,0.3)]" />
    </div>
  );
}

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

const NAV = [
  { label: "Projects", href: "/gallery" },
  { label: "Pricing", href: "/pricing" },
  { label: "About", href: "/about" },
];

export default function Home() {
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

        {/* header: x40 y40, 1200×64 */}
        <header className="absolute left-[40px] top-[40px] flex h-16 w-[1200px] items-center justify-between">
          <Link href="/" aria-label="gaze home" className="flex h-[60px] w-[60px] items-center justify-center">
            <LogoMark />
          </Link>
          <nav className="flex items-center gap-12" aria-label="Primary">
            <div className="flex items-center gap-5">
              {NAV.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className="flex h-[52px] w-[116px] items-center justify-center rounded-[12px] text-[20px] font-normal leading-7 text-[#f5f7f7] transition-opacity hover:opacity-75"
                >
                  {item.label}
                </Link>
              ))}
            </div>
            <Link
              href="/account"
              aria-label="Account"
              className="flex h-[61px] w-[61px] items-center justify-center rounded-full bg-[#1d1d1d]/80 shadow-[inset_0_1px_1px_rgba(255,255,255,0.5),inset_0_0_22px_rgba(255,255,255,0.12)] backdrop-blur-[40px] transition-opacity hover:opacity-85"
            >
              <UserIcon />
            </Link>
          </nav>
        </header>

        {/* wordmark: full-logo vectors x566 y198, 148×56; 72px em box
            carries ~17px top bearing, so top-181 lands glyphs on 198 */}
        <div className="absolute left-1/2 top-[181px] -translate-x-1/2">
          <div className="relative">
            <div aria-hidden className="absolute left-1/2 top-1/2 h-[99px] w-[251px] -translate-x-1/2 -translate-y-1/2 bg-[#f2f2fa]/50 blur-[100px]" />
            <h1 className="relative text-[72px] font-light italic leading-none tracking-[-0.02em]">
              gaz
              <span
                className="-mr-[0.12em] pr-[0.12em] text-transparent"
                style={{
                  backgroundImage: "radial-gradient(circle at 50% 50%, #4a58bf, #4cbbc1)",
                  backgroundClip: "text",
                  WebkitBackgroundClip: "text",
                }}
              >
                e
              </span>
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
          {/* ring mark at 3 o'clock: center +(205.5, 4.5) from orbit center */}
          <div
            className="absolute"
            style={{
              left: "calc(50% + 205.5px)",
              top: "calc(50% + 4.5px)",
              transform: "translate(-50%, -50%)",
            }}
          >
            <OrbitMark />
          </div>
        </div>

        <VoicePrompt />
      </ScaleStage>
    </main>
  );
}
