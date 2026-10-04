// Shared site header (Landing + Flow 3 frames).
// Geometry: x40 y40, 1200×64 in 1280×832 frame coordinates. Twin of the
// header inlined in app/page.tsx — kept as a component so new routes share
// it without duplicating markup again.
import Link from "next/link";

const NAV = [
  { label: "Projects", href: "/gallery" },
  { label: "Pricing", href: "/pricing" },
  { label: "About", href: "/about" },
];

export function LogoMark() {
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

export default function SiteHeader() {
  return (
    <header className="absolute left-[40px] top-[40px] flex h-16 w-[1200px] items-center justify-between">
      <Link href="/" aria-label="gaze home" className="flex h-[60px] w-[60px] items-center justify-center">
        <LogoMark />
      </Link>
      <nav className="flex items-center gap-12" aria-label="Primary">
        <div className="flex items-center gap-5">
          {NAV.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="flex h-[52px] w-[116px] items-center justify-center rounded-[12px] text-[20px] font-normal leading-7 text-[#f5f7f7] transition-opacity hover:opacity-75"
            >
              {item.label}
            </a>
          ))}
        </div>
        <a
          href="/account"
          aria-label="Account"
          className="flex h-[61px] w-[61px] items-center justify-center rounded-full bg-[#1d1d1d]/80 shadow-[inset_0_1px_1px_rgba(255,255,255,0.5),inset_0_0_22px_rgba(255,255,255,0.12)] backdrop-blur-[40px] transition-opacity hover:opacity-85"
        >
          <UserIcon />
        </a>
      </nav>
    </header>
  );
}
