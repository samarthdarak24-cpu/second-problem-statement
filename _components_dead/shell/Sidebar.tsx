'use client';

/**
 * The sidebar.
 *
 * One row per page, grouped, with the active route marked by a tinted
 * background and an accent bar. The footer carries the honesty statement rather
 * than burying it on a page, because a model estimate that never says so is the
 * failure mode this project is most concerned with.
 *
 * The active marker is a single `motion` element with a shared `layoutId`, so it
 * slides between rows instead of cross-fading. That is a small thing, but it is
 * the difference between a nav that feels like a rendered document and one that
 * feels like an application — and it costs one element, not a library of
 * transitions.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowUpRight, ShieldAlert, Thermometer } from 'lucide-react';
import { NAV_GROUPS, NAV_ITEMS, isNavActive } from './nav';
import { useDesignStore } from '@/store/designStore';
import { cn } from '@/lib/utils';

export function Sidebar() {
  const pathname = usePathname();
  const location = useDesignStore((state) => state.location);
  const climateData = useDesignStore((state) => state.climateData);

  return (
    <aside className="sticky top-0 hidden h-screen w-[264px] shrink-0 flex-col border-r bg-panel lg:flex">
      {/* ---------------- Brand ---------------- */}
      <div className="border-b px-5 py-5">
        <Link href="/" className="group flex items-center gap-3">
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"
            style={{ boxShadow: '0 1px 2px 0 hsl(18 68% 24% / 0.25)' }}
          >
            <Thermometer size={17} />
          </span>
          <div className="min-w-0">
            <p className="truncate font-display text-[14px] font-semibold leading-tight text-foreground">
              Thermal Shelter
            </p>
            <p className="flex items-center gap-1 truncate text-[11.5px] text-muted-foreground">
              SIH PS-51
              <ArrowUpRight
                size={11}
                className="opacity-0 transition-opacity group-hover:opacity-100"
                aria-hidden
              />
            </p>
          </div>
        </Link>
      </div>

      {/* ---------------- Navigation ---------------- */}
      <nav className="scroll-area min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {NAV_GROUPS.map((group) => {
          const items = NAV_ITEMS.filter((item) => item.group === group);
          if (items.length === 0) return null;

          return (
            <div key={group} className="mb-5 last:mb-0">
              <p className="kicker px-3 pb-2">{group}</p>
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const active = isNavActive(pathname, item.href);
                  const Icon = item.icon;

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        title={item.description}
                        className={cn(
                          'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors',
                          active
                            ? 'text-primary'
                            : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                        )}
                      >
                        {active ? (
                          <motion.span
                            layoutId="sidebar-active"
                            aria-hidden
                            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                            className="absolute inset-0 -z-10 rounded-lg bg-primary/10"
                          />
                        ) : null}
                        {active ? (
                          <motion.span
                            layoutId="sidebar-active-bar"
                            aria-hidden
                            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                            className="absolute inset-y-1.5 left-0 w-[2.5px] rounded-full bg-primary"
                          />
                        ) : null}
                        <Icon size={16} className="shrink-0" aria-hidden />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* ---------------- Footer ---------------- */}
      <div className="border-t px-5 py-4">
        {location ? (
          <div className="mb-3">
            <p className="kicker">Current site</p>
            <p className="mt-1 truncate text-[13px] font-medium text-foreground">
              {location.city}
            </p>
            <p className="truncate text-[11.5px] text-muted-foreground">
              {climateData ? climateData.climateType : location.state}
            </p>
          </div>
        ) : null}

        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/[0.07] px-2.5 py-2">
          <ShieldAlert size={13} className="mt-[2px] shrink-0 text-warning" aria-hidden />
          <p className="text-[12px] leading-snug text-muted-foreground">
            Model estimates — not measurements. See{' '}
            <Link href="/dashboard/method" className="font-medium text-primary hover:underline">
              Method &amp; Limits
            </Link>
            .
          </p>
        </div>
      </div>
    </aside>
  );
}
