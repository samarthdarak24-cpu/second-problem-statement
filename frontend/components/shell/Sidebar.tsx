'use client';

/**
 * The sidebar.
 *
 * One row per page, grouped by purpose (Main / Design / Compare /
 * Reference / System). The active route is marked by a tinted
 * pastel background and a subtle left accent — never a heavy dark
 * block.
 *
 * The footer carries the honesty statement (model estimate) and a
 * status pill, rather than burying either on a page: a model
 * estimate that never says so is the failure mode this project is
 * most concerned with.
 *
 * The active marker is a single `motion` element with a shared
 * `layoutId`, so it slides between rows instead of cross-fading.
 * That is a small thing, but it is the difference between a nav
 * that feels like a rendered document and one that feels like an
 * application.
 *
 * VISUAL PASS
 * The rail is now a distinct surface rather than a tint of the page:
 * it carries its own very faint vertical gradient, a right-hand
 * hairline, and an inner highlight along that edge, so the content
 * area reads as a sheet laid on top of it. Nav rows gained a hover
 * state with real depth, group headings gained a rule, and the
 * footer's status pill is now the one place in the chrome that shows
 * a *live* indicator.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { Cloud, ShieldAlert, Thermometer } from 'lucide-react';
import { NAV_GROUPS, NAV_ITEMS, UTILITY_LINKS, isNavActive } from './nav';
import { useDesignStore } from '@/store/designStore';
import { cn } from '@/lib/utils';

export function Sidebar() {
  const pathname = usePathname();
  const location = useDesignStore((state) => state.location);
  const climateData = useDesignStore((state) => state.climateData);
  const isGenerating = useDesignStore((state) => state.isGenerating);

  const statusTone = isGenerating ? 'Generating' : climateData ? 'Ready' : 'Idle';
  const statusColor = isGenerating
    ? 'hsl(18 68% 44%)'
    : climateData
      ? 'hsl(158 46% 30%)'
      : 'hsl(27 9% 50%)';

  return (
    <aside
      className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col border-r lg:flex"
      style={{
        background:
          'linear-gradient(180deg, hsl(36 24% 98%) 0%, hsl(36 18% 96%) 100%)',
        borderColor: 'hsl(30 14% 88% / 0.75)',
        /* A hair of light along the rail's inner edge — the same
           treatment the panels use, so the chrome and the content
           share one lighting model. */
        boxShadow: 'inset -1px 0 0 0 hsl(0 0% 100% / 0.55)',
      }}
    >
      {/* ---------------- Brand ---------------- */}
      <div className="px-5 pb-5 pt-6">
        <Link href="/" className="group flex items-center gap-3">
          <span
            aria-hidden
            className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] transition-transform duration-200 group-hover:scale-[1.04]"
            style={{
              background:
                'linear-gradient(140deg, hsl(22 78% 56%) 0%, hsl(18 68% 40%) 55%, hsl(16 62% 33%) 100%)',
              boxShadow:
                'inset 0 1px 0 0 hsl(30 90% 78% / 0.5), 0 4px 14px -4px hsl(18 68% 30% / 0.45)',
              color: 'white',
            }}
          >
            <Thermometer size={18} />
          </span>
          <div className="min-w-0">
            <p className="truncate font-display text-[14.5px] font-semibold leading-tight tracking-[-0.015em] text-foreground">
              Thermal Shelter
            </p>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              SIH PS-51
            </p>
          </div>
        </Link>
      </div>

      {/* A faint rule instead of a hard border — the brand block and the
          navigation are one column, so the divider should suggest a
          break rather than close a box. */}
      <div className="rule-fade mx-5 mb-1" aria-hidden />

      {/* ---------------- Navigation ---------------- */}
      <nav className="scroll-area min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-3">
        {NAV_GROUPS.map((group, groupIdx) => {
          const items = NAV_ITEMS.filter((item) => item.group === group);
          if (items.length === 0) return null;

          return (
            <div
              key={group}
              className={cn(groupIdx > 0 && 'mt-5')}
            >
              {/* The group heading: label plus a rule that runs to the
                  edge of the rail. The rule is what gives the rail a
                  readable vertical rhythm — without it the headings
                  float and the groups blur together. */}
              <div className="flex items-center gap-2 px-3 pb-2">
                <p className="kicker shrink-0">{group}</p>
                <span
                  aria-hidden
                  className="h-px grow"
                  style={{
                    background:
                      'linear-gradient(90deg, hsl(30 14% 88%) 0%, transparent 100%)',
                  }}
                />
              </div>
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
                          'group relative flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-[13px] font-medium transition-colors',
                          active
                            ? 'text-foreground'
                            : 'text-muted-foreground hover:bg-white/70 hover:text-foreground',
                        )}
                      >
                        {active ? (
                          <motion.span
                            layoutId="sidebar-active"
                            aria-hidden
                            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                            className="absolute inset-0 -z-10 rounded-[10px]"
                            style={{
                              background:
                                'linear-gradient(135deg, hsl(var(--pastel-blue)) 0%, hsl(var(--pastel-blue-deep)) 100%)',
                              boxShadow:
                                'inset 0 1px 0 0 hsl(0 0% 100% / 0.75), inset 0 0 0 1px hsl(213 58% 87%), 0 1px 3px -1px hsl(213 40% 40% / 0.14)',
                            }}
                          />
                        ) : null}
                        {active ? (
                          <motion.span
                            layoutId="sidebar-active-bar"
                            aria-hidden
                            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                            className="absolute inset-y-2 left-0 w-[2.5px] rounded-full"
                            style={{
                              background:
                                'linear-gradient(180deg, hsl(22 78% 52%) 0%, hsl(18 68% 40%) 100%)',
                              boxShadow: '0 0 8px -1px hsl(18 68% 44% / 0.5)',
                            }}
                          />
                        ) : null}
                        <Icon
                          size={15}
                          className={cn(
                            'shrink-0 transition-colors',
                            active
                              ? 'text-foreground'
                              : 'text-muted-foreground/80 group-hover:text-foreground/80',
                          )}
                          aria-hidden
                        />
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
      <div
        className="px-4 py-4"
        style={{
          borderTop: '1px solid hsl(30 14% 88% / 0.7)',
          background: 'hsl(36 20% 97% / 0.6)',
        }}
      >
        {location ? (
          <div className="mb-3 flex items-center gap-2.5 rounded-[12px] border bg-panel px-2.5 py-2"
            style={{
              borderColor: 'hsl(30 14% 88% / 0.7)',
              boxShadow: 'var(--inset-highlight)',
            }}
          >
            <span
              aria-hidden
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
              style={{
                background:
                  'linear-gradient(140deg, hsl(var(--pastel-mint)) 0%, hsl(var(--pastel-mint-deep)) 100%)',
                boxShadow: 'inset 0 1px 0 0 hsl(0 0% 100% / 0.7)',
              }}
            >
              <Cloud size={13} style={{ color: 'hsl(var(--pastel-mint-fg))' }} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[12.5px] font-semibold text-foreground">
                {location.city}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {climateData ? climateData.climateType : location.state}
              </p>
            </div>
          </div>
        ) : null}

        {/* Reference and configuration. Deliberately small: these are not
            steps in the workflow, so they should not read like one. */}
        <ul className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          {UTILITY_LINKS.map((item) => {
            const active = isNavActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  title={item.description}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'text-[11.5px] transition-colors hover:underline',
                    active ? 'font-semibold text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Status pill. The dot is the app's one live indicator: it
            breathes while a run is in flight and sits still once the
            climate is resolved, so "working" is legible from across the
            room without reading the label. */}
        <div className="mb-3 flex items-center justify-between gap-2 rounded-full border bg-panel px-2.5 py-1.5"
          style={{
            borderColor: 'hsl(30 14% 88% / 0.7)',
            boxShadow: 'var(--inset-highlight)',
          }}
        >
          <span className="flex items-center gap-1.5">
            <span
              className={cn('h-1.5 w-1.5 rounded-full', isGenerating && 'animate-breathe')}
              style={{ background: statusColor }}
              aria-hidden
            />
            <span className="text-[11.5px] font-semibold text-foreground/85">
              {statusTone}
            </span>
          </span>
        </div>

        <div className="flex items-start gap-2 rounded-[10px] border px-2.5 py-2"
          style={{
            borderColor: 'hsl(35 85% 38% / 0.28)',
            background:
              'linear-gradient(180deg, hsl(38 80% 96%) 0%, hsl(35 80% 94%) 100%)',
          }}
        >
          <ShieldAlert
            size={12}
            className="mt-[2px] shrink-0"
            style={{ color: 'hsl(var(--warning-ink))' }}
            aria-hidden
          />
          <p className="text-[11px] leading-snug" style={{ color: 'hsl(var(--warning-ink) / 0.85)' }}>
            Model estimates — not measurements. See{' '}
            <span className="font-semibold">Method &amp; Limits</span> above.
          </p>
        </div>
      </div>
    </aside>
  );
}