'use client';

/**
 * Mobile bottom navigation.
 *
 * Below `lg` the sidebar is hidden and the header concentrates on the site and
 * the Generate action, which leaves nowhere to go on a phone. Five destinations
 * fit a thumb: Home, Design, Analysis, Optimize and a More sheet for everything
 * else — the brief's specified set, and the five a user actually switches
 * between while working.
 *
 * It renders only under `lg` via CSS rather than a media-query hook, so there is
 * no hydration mismatch and no first-paint flash of the wrong chrome.
 */

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  Archive,
  BookOpen,
  ClipboardList,
  GitCompare,
  Layers,
  LayoutDashboard,
  MapPin,
  Settings,
  SlidersHorizontal,
  Target,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { NAV_ITEMS, UTILITY_LINKS, isNavActive } from './nav';

/* ------------------------------------------------------------------ */
/* The five primary destinations                                       */
/* ------------------------------------------------------------------ */

const PRIMARY = [
  { href: '/dashboard', label: 'Home', icon: LayoutDashboard },
  { href: '/dashboard/design', label: 'Design', icon: SlidersHorizontal },
  { href: '/dashboard/analysis', label: 'Analysis', icon: Activity },
  { href: '/dashboard/optimization', label: 'Optimize', icon: Target },
] as const;

/**
 * Everything the primary row does not cover. `Archive` is the sheet's own icon
 * so "More" does not silently borrow a page's identity.
 */
const MORE_ICONS: Record<string, typeof Archive> = {
  '/dashboard/climate': MapPin,
  '/dashboard/brief': ClipboardList,
  '/dashboard/scenarios': GitCompare,
  '/dashboard/materials': Layers,
  '/dashboard/method': BookOpen,
  '/dashboard/settings': Settings,
};

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  /* Any route in the "more" set keeps the More button lit, so the user can
     tell which group the page they are on belongs to. */
  const moreActive = [...NAV_ITEMS, ...UTILITY_LINKS].some(
    (item) => !PRIMARY.some((entry) => entry.href === item.href) && isNavActive(pathname, item.href),
  );

  const moreItems = [...NAV_ITEMS, ...UTILITY_LINKS].filter(
    (item) => !PRIMARY.some((entry) => entry.href === item.href),
  );

  return (
    <>
      {/* -------- The More sheet -------- */}
      <AnimatePresence>
        {open ? (
          <>
            <motion.button
              key="mobile-nav-scrim"
              type="button"
              aria-label="Close navigation"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 bg-foreground/25 backdrop-blur-[2px] lg:hidden"
            />

            <motion.div
              key="mobile-nav-sheet"
              initial={{ y: '100%', opacity: 0.6 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0.6 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="fixed inset-x-0 bottom-[76px] z-50 mx-3 overflow-hidden rounded-[24px] border bg-panel lg:hidden"
              style={{
                borderColor: 'hsl(30 14% 88% / 0.8)',
                boxShadow: 'var(--shadow-overlay)',
              }}
              role="dialog"
              aria-label="More destinations"
            >
              {/* A grabber, so the sheet reads as a sheet rather than as a
                  panel that happens to be floating. */}
              <div className="flex justify-center pt-2.5" aria-hidden>
                <span
                  className="h-1 w-9 rounded-full"
                  style={{ background: 'hsl(30 14% 84%)' }}
                />
              </div>
              <div className="grid grid-cols-2 gap-1.5 p-3">
                {moreItems.map((item) => {
                  const Icon = MORE_ICONS[item.href] ?? Archive;
                  const active = isNavActive(pathname, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className={cn(
                        'flex flex-col gap-2 rounded-2xl border px-3.5 py-3 transition-all duration-150',
                        active
                          ? 'border-transparent'
                          : 'border-transparent hover:bg-secondary/55 active:scale-[0.98]',
                      )}
                      style={
                        active
                          ? {
                              background:
                                'linear-gradient(140deg, hsl(var(--pastel-blue)) 0%, hsl(var(--pastel-blue-deep)) 100%)',
                              color: 'hsl(var(--pastel-blue-fg))',
                              boxShadow:
                                'inset 0 0 0 1px hsl(213 58% 87%), var(--shadow-hairline)',
                            }
                          : undefined
                      }
                    >
                      <Icon size={16} aria-hidden />
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold">
                          {item.label}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] opacity-70">
                          {item.description}
                        </span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>

      {/* -------- The bar --------
           Floated rather than edge-to-edge: it now sits inside the page
           with a margin, rounds all four corners, and carries the overlay
           shadow. A bar welded to the bottom edge of the screen reads as
           system chrome (a browser toolbar); a floating pill reads as part
           of the application, which matters on a device where this is the
           only navigation there is. */}
      <nav
        className="fixed inset-x-3 bottom-3 z-40 rounded-[22px] border lg:hidden"
        style={{
          background: 'hsl(36 24% 98% / 0.9)',
          backdropFilter: 'blur(16px) saturate(160%)',
          WebkitBackdropFilter: 'blur(16px) saturate(160%)',
          borderColor: 'hsl(30 14% 88% / 0.8)',
          boxShadow: 'var(--shadow-overlay)',
          marginBottom: 'env(safe-area-inset-bottom)',
        }}
        aria-label="Primary"
      >
        <div className="flex items-stretch">
          {PRIMARY.map((entry) => {
            const Icon = entry.icon;
            const active = isNavActive(pathname, entry.href);
            return (
              <Link
                key={entry.href}
                href={entry.href}
                className="relative flex flex-1 flex-col items-center gap-1 px-1 py-2.5"
                aria-current={active ? 'page' : undefined}
              >
                {active ? (
                  <motion.span
                    layoutId="mobile-nav-active"
                    className="absolute inset-x-3 -top-px h-[3px] rounded-full"
                    style={{
                      background:
                        'linear-gradient(90deg, hsl(22 78% 52%) 0%, hsl(18 68% 42%) 100%)',
                      boxShadow: '0 2px 8px -2px hsl(18 68% 44% / 0.6)',
                    }}
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                  />
                ) : null}
                <Icon
                  size={18}
                  aria-hidden
                  style={{ color: active ? 'hsl(var(--primary))' : undefined }}
                  className={active ? '' : 'text-muted-foreground'}
                />
                <span
                  className={cn(
                    'text-[10.5px] font-semibold tracking-[-0.01em]',
                    active ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {entry.label}
                </span>
              </Link>
            );
          })}

          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="relative flex flex-1 flex-col items-center gap-1 px-1 py-2.5"
          >
            {moreActive || open ? (
              <motion.span
                layoutId="mobile-nav-active"
                className="absolute inset-x-3 -top-px h-[3px] rounded-full"
                style={{
                  background:
                    'linear-gradient(90deg, hsl(22 78% 52%) 0%, hsl(18 68% 42%) 100%)',
                  boxShadow: '0 2px 8px -2px hsl(18 68% 44% / 0.6)',
                }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              />
            ) : null}
            <Archive
              size={18}
              aria-hidden
              style={{ color: moreActive || open ? 'hsl(var(--primary))' : undefined }}
              className={moreActive || open ? '' : 'text-muted-foreground'}
            />
            <span
              className={cn(
                'text-[10.5px] font-semibold tracking-[-0.01em]',
                moreActive || open ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              More
            </span>
          </button>
        </div>
      </nav>
    </>
  );
}
