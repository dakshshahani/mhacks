// Flow 3 option card (Method chooser + Upload source chooser).
// Figma: 336×288 glass card, 24px icon, 16px Jost title/desc/CTA.
// Whole card is the link; titles/descs come straight from the frames.
import Link from "next/link";
import type { ReactNode } from "react";

export interface OptionCardProps {
  href: string;
  icon: ReactNode;
  title: string;
  description: string;
  cta: string;
}

export default function OptionCard({ href, icon, title, description, cta }: OptionCardProps) {
  return (
    <Link
      href={href}
      className="group flex h-[288px] w-[336px] shrink-0 flex-col rounded-[24px] bg-gradient-to-b from-[#666666]/40 via-[#1d1d1d]/90 to-[#1d1d1d] p-[28px] shadow-[inset_0_1px_1px_rgba(255,255,255,0.5),inset_0_0_22px_rgba(255,255,255,0.12)] backdrop-blur-[40px] outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-white/70"
    >
      <span aria-hidden className="block text-[#f5f7f7]">
        {icon}
      </span>
      <span className="mt-[14px] block text-[16px] font-normal leading-6 text-[#f5f7f7]">{title}</span>
      <span className="mt-[4px] block text-[16px] font-normal leading-6 text-[#c5cad3]">{description}</span>
      <span className="mt-auto block pt-[16px] text-[16px] font-normal leading-6 text-[#f5f7f7]">
        {cta} <span aria-hidden className="inline-block transition-transform group-hover:translate-x-1">→</span>
      </span>
    </Link>
  );
}
