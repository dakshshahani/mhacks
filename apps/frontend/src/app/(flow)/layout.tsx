'use client';

/* Flow shell (home / gallery / new / import / about / account / pricing):
   the shared grid, fade, and SiteHeader sit outside the transition. Only
   route content changes. Frozen under prefers-reduced-motion. */
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";
import { useContext, useRef, type ReactNode } from "react";
import { LayoutRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import ScaleStage from "../stage";
import SiteHeader from "../components/site-header";

function FrozenRouter({ children }: { children: ReactNode }) {
  const context = useContext(LayoutRouterContext);
  // AnimatePresence retains this keyed subtree for its exit. Keep its router
  // segment too, or Next swaps in the destination page before exit completes.
  const frozenContext = useRef(context).current;
  return (
    <LayoutRouterContext.Provider value={frozenContext}>
      {children}
    </LayoutRouterContext.Provider>
  );
}

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
            every absolute frame coordinate below keeps working untouched.
            mode="wait" gives a true fade OUT then fade IN (a synced
            crossfade is invisible on near-black pages). Each phase carries
            its own direction — old drifts up-and-out, new rises in — so the
            out/in order is unmistakable. Total ~0.9s. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 16, scale: 0.99 }}
            animate={{
              opacity: 1,
              y: 0,
              scale: 1,
              transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
            }}
            exit={{
              opacity: 0,
              y: -12,
              scale: 0.99,
              transition: { duration: 0.45, ease: "easeInOut" },
            }}
            transition={
              reduce ? { duration: 0 } : { duration: 0.45, ease: [0.22, 1, 0.36, 1] }
            }
            className="absolute inset-0"
          >
            <FrozenRouter>{children}</FrozenRouter>
          </motion.div>
        </AnimatePresence>
      </ScaleStage>
    </main>
  );
}
