// Flow 3 back navigation (Hifi "Back to Projects / Starting Points button"
// instances): 38px glass pill, arrow + 16px label.
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { GLASS } from "./glass";

export default function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className={`inline-flex h-[38px] items-center gap-[10px] rounded-full bg-[#1d1d1d]/80 py-0 pl-[14px] pr-[20px] text-[16px] font-normal leading-[23px] text-[#f5f7f7] ${GLASS} transition-opacity hover:opacity-85`}
    >
      <ArrowLeft size={18} aria-hidden />
      {label}
    </Link>
  );
}
