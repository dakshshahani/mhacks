// Flow 3 back navigation (Hifi "Back to Projects / Starting Points button"
// instances): 38px pill, glass icon cell + label cell. Hover brightens the
// icon cell only (label cell unchanged per the Hover variant).
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { GLASS } from "./glass";

export default function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className={`group inline-flex h-[38px] items-stretch gap-[4px] rounded-[20px] bg-[#282d35] p-[3px] text-[16px] font-normal leading-[23px] outline-none transition focus-visible:ring-2 focus-visible:ring-white/70 ${GLASS}`}
    >
      <span
        aria-hidden
        className="flex w-[52px] items-center justify-center rounded-[17px] bg-[#1d1d1d]/55 shadow-[inset_0_1px_1px_rgba(255,255,255,0.5)] transition group-hover:bg-[#1d1d1d]/10"
      >
        <ArrowLeft size={18} className="text-[#f5f7f7]" />
      </span>
      <span className="flex items-center rounded-[17px] bg-[#1d1d1d]/55 pr-[20px] text-[#a5adba]">
        {label}
      </span>
    </Link>
  );
}
