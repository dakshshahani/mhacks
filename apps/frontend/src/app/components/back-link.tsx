// Flow 3 back navigation: arrow + label, Jost 16px.
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-[10px] text-[16px] font-normal leading-[23px] text-[#f5f7f7] transition-opacity hover:opacity-75"
    >
      <ArrowLeft size={18} aria-hidden />
      {label}
    </Link>
  );
}
