'use client';

/* Flow shell (gallery / new / import): the frame every route here shares —
   blueprint grid, header fade, SiteHeader — sits OUTSIDE the transition, so
   a route change never touches it. Only the content that actually changes
   animates: a soft crossfade with a slight rise, keyed by pathname
   (AnimatePresence). Frozen under prefers-reduced-motion. */
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import ScaleStage from "../stage";
import SiteHeader from "../components/site-header";

export default function FlowLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const reduce = useReducedMotion();
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
        {/* Route content: absolute inset-0 coincides with the stage box, so
            every absolute frame coordinate below keeps working untouched. */}
        <AnimatePresence initial={false}>
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={
              reduce ? { duration: 0 } : { duration: 0.28, ease: [0.22, 1, 0.36, 1] }
            }
            className="absolute inset-0"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </ScaleStage>
    </main>
  );
}
