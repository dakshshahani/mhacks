// Shared site header (Landing + Flow 3 frames).
// Geometry: x40 y40, 1200×64 in 1280×832 frame coordinates. Twin of the
// header inlined in app/page.tsx — kept as a component so new routes share
// it without duplicating markup again.
import Link from "next/link";
import { GLASS } from "./glass";

const NAV = [
  { label: "Projects", href: "/gallery" },
  { label: "Pricing", href: "/pricing" },
  { label: "About", href: "/about" },
];

export function LogoMark({ className = "h-[34px]" }: { className?: string }) {
  return (
    <img
      src="/gaze-mark.svg"
      alt=""
      aria-hidden
      width={34}
      height={37}
      className={`inline-block w-auto ${className}`}
    />
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
    <header className="absolute left-[40px] top-[40px] z-20 flex h-16 w-[1200px] items-center justify-between">
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
          className={`group flex h-[61px] w-[61px] items-center justify-center rounded-full bg-[#1d1d1d]/80 ${GLASS} transition-colors hover:bg-[#0b0b0b]/90 focus-visible:ring-2 focus-visible:ring-white/70`}
        >
          <UserIcon />
        </Link>
      </nav>
    </header>
  );
}
