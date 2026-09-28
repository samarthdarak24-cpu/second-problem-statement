'use client';

/**
 * The workspace shell.
 *
 * Sidebar on the left, compact header at the top, content on the
 * right. The shell — not the page — runs the pipeline on first
 * mount, and it runs it on *any* route. That matters because the
 * store is module-level: client-side navigation preserves it, but a
 * hard refresh on `/dashboard/analysis` would otherwise land on an
 * empty page with no way to populate it. Booting in the shell means
 * every route can be a deep link.
 *
 * The 8-stage pipeline that used to live above every page has been
 * removed from the global layout. The Dashboard now shows a compact
 * progress strip; while a run is in flight a Generation overlay
 * covers the page. The pipeline on the shell was redundant with
 * that, and the brief calls it out as the single biggest source of
 * clutter.
 */

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { useDesignStore } from '@/store/designStore';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { MobileNav } from './MobileNav';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const generate = useDesignStore((state) => state.generate);
  const isGenerating = useDesignStore((state) => state.isGenerating);
  const climateData = useDesignStore((state) => state.climateData);

  /*
   * Run the pipeline once on open, so the app lands on a finished
   * analysis rather than an empty shell. The ref guard is what makes
   * this safe against React's double-invoked effects in development.
   */
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current || isGenerating || climateData) return;
    booted.current = true;
    void generate();
  }, [generate, isGenerating, climateData]);

  return (
    /*
     * `reducedMotion="user"` makes every framer-motion animation in the
     * tree honour the OS "reduce motion" setting. It is set here, once, at
     * the root, because the alternative — a `useReducedMotion()` guard in
     * each animated component — has to be remembered in every new
     * component and is silently forgotten in the tenth one. There are
     * already nine files using framer-motion; this covers all of them
     * without touching any of them.
     *
     * The effect is that transforms become instant while opacity still
     * fades, so nothing disappears — it just stops moving.
     */
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-screen w-full">
        <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />

        {/*
          Keyed on pathname so each route animates in. Kept to opacity
          plus a short rise — a longer or more directional transition
          makes moving between pages feel like waiting rather than
          navigating.

          The bottom padding clears the mobile navigation bar, which is
          fixed and would otherwise sit on top of the last card. It grew
          when the bar became a floating pill with a 12px bottom inset and
          a drop shadow — at the previous 96px the shadow still fell
          across the last row of text on a short page.
        */}
        <main className="min-w-0 flex-1 px-0 pb-[7.5rem] pt-0 lg:pb-10 lg:pt-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>

        {/*
          The honesty statement. It is the last thing on every page by
          design — but it is *chrome*, not content, so it must not read
          as loudly as the page above it.

          Two changes make that work: it sits on a faintly sunken band
          rather than the page canvas, separated by a fading rule instead
          of a hard border, and the model caveat is set in a warning tint
          so the eye resolves it as a standing note rather than as a new
          paragraph to read.
        */}
        <footer className="border-t"
          style={{
            borderColor: 'hsl(30 14% 88% / 0.6)',
            background:
              'linear-gradient(180deg, hsl(36 24% 98%) 0%, hsl(36 20% 96.5%) 100%)',
          }}
        >
          <div className="px-6 py-5">
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5">
              <span className="kicker section-rule shrink-0">Honesty statement</span>
              <span className="max-w-[880px] text-[12px] leading-relaxed text-muted-foreground">
                Every comfort, energy and cost figure in this application is the
                output of a simplified quasi-steady-state monthly heat-balance
                model — an engineering estimate, not a measurement and not a
                validated whole-building simulation. Use it to compare design
                options and to reason about strategy; validate with measured
                data before construction.
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground/70">
              <span>SIH Problem Statement 51</span>
              <span aria-hidden>·</span>
              <span>Next.js · React · TypeScript</span>
              <span aria-hidden>·</span>
              <span>Three.js · React Three Fiber</span>
              <span aria-hidden>·</span>
              <span>ISO 7730 PMV/PPD · ASHRAE 55 adaptive</span>
            </div>
          </div>
        </footer>
      </div>

      {/* Below `lg` the sidebar is hidden, so this is the only way to move
          between sections on a phone or a narrow tablet. */}
      <MobileNav />
      </div>
    </MotionConfig>
  );
}