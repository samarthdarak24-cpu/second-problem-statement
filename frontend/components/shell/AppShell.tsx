'use client';

/**
 * The workspace shell.
 *
 * Sidebar on the left, sticky topbar above the page, content on the right.
 *
 * The shell — not the page — runs the pipeline on first mount, and it runs it
 * on *any* route. That matters because the store is module-level: client-side
 * navigation preserves it, but a hard refresh on `/dashboard/analysis` would
 * otherwise land on an empty page with no way to populate it. Booting in the
 * shell means every route can be a deep link.
 */

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { useDesignStore } from '@/store/designStore';
import { NAV_ITEMS, isNavActive } from './nav';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { PipelineFlow } from '@/components/dashboard/PipelineFlow';
import { cn } from '@/lib/utils';

/**
 * Horizontal nav for viewports below `lg`, where the sidebar is hidden.
 *
 * Not a hamburger: there are only eight destinations and they fit in a
 * scrollable strip, so a drawer would add a tap and hide the map of the app for
 * no benefit. The strip scrolls horizontally and snaps, which is the behaviour
 * people already expect from a tab bar.
 */
function CompactNav() {
  const pathname = usePathname();

  return (
    <nav className="scroll-area -mx-1 flex gap-1 overflow-x-auto border-b bg-panel px-6 py-2 lg:hidden">
      {NAV_ITEMS.map((item) => {
        const active = isNavActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium transition-colors',
              active
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
            )}
          >
            <Icon size={14} aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const generate = useDesignStore((state) => state.generate);
  const isGenerating = useDesignStore((state) => state.isGenerating);
  const climateData = useDesignStore((state) => state.climateData);

  /*
   * Run the pipeline once on open, so the app lands on a finished analysis
   * rather than an empty shell. The ref guard is what makes this safe against
   * React's double-invoked effects in development.
   */
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current || isGenerating || climateData) return;
    booted.current = true;
    void generate();
  }, [generate, isGenerating, climateData]);

  return (
    <div className="flex min-h-screen w-full">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <CompactNav />

        {/*
          The pipeline is rendered here, above every page, because the brief asks
          for the chain to be *visible* and a stage diagram that only appears on
          one page is not visible — it is a feature of that page. Kept outside
          `main` so it reads as the spine of the app rather than as the first
          block of whatever page you happen to be on.
        */}
        <div className="px-6 pt-6">
          <PipelineFlow />
        </div>

        <main className="min-w-0 flex-1 px-6 py-6">
          {/*
            Keyed on pathname so each route animates in. Kept to opacity plus a
            short rise — a longer or more directional transition makes moving
            between pages feel like waiting rather than navigating.
          */}
          <AnimatePresence mode="wait">
            <motion.div
              key={pathname}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>

        <footer className="border-t bg-panel px-6 py-5">
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5">
            <span className="kicker">Honesty statement</span>
            <span className="max-w-[880px] text-[12px] leading-relaxed text-muted-foreground">
              Every comfort, energy and cost figure in this application is the output of a
              simplified quasi-steady-state monthly heat-balance model — an engineering estimate,
              not a measurement and not a validated whole-building simulation. Use it to compare
              design options and to reason about strategy; validate with measured data before
              construction.
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
        </footer>
      </div>
    </div>
  );
}
