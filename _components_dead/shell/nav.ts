/**
 * Navigation model for the workspace shell.
 *
 * The order is the order of the pipeline, because that is the mental model the
 * whole project is built around:
 *
 *   site → design → climate → analysis → optimisation → materials
 *
 * Overview and Method are deliberately outside that run: one is the summary you
 * land on, the other is the reference you consult when you want to know what a
 * number means. Putting them in the middle of the pipeline would break the one
 * sequence the interface exists to make legible.
 *
 * `group` drives the sidebar's section headings. It is presentation only — the
 * route is the identity, so adding a page never means touching the shell.
 *
 * Every href is namespaced under `/dashboard`, which leaves `/` free for the
 * landing page and `/login` free for sign-in. Nesting also means the shell
 * layout applies to exactly the routes that want it, rather than to the whole
 * site.
 */

import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BookOpen,
  BrainCircuit,
  CloudSun,
  GitCompare,
  Layers,
  LayoutDashboard,
  SlidersHorizontal,
  Target,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  /** Shown under the label in the sidebar and as the page's own subtitle. */
  description: string;
  icon: LucideIcon;
  group: 'Overview' | 'Design' | 'Reference';
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    href: '/dashboard',
    label: 'Overview',
    description: 'Site summary, key metrics and the pipeline at a glance',
    icon: LayoutDashboard,
    group: 'Overview',
  },
  {
    href: '/dashboard/design',
    label: 'Design Studio',
    description: 'Programme parameters, the parametric 3D model, and live results',
    icon: SlidersHorizontal,
    group: 'Design',
  },
  {
    href: '/dashboard/climate',
    label: 'Climate',
    description: 'What the site asks of a building, month by month',
    icon: CloudSun,
    group: 'Design',
  },
  {
    href: '/dashboard/analysis',
    label: 'Thermal Analysis',
    description: 'Comfort, energy and the monthly heat balance',
    icon: Activity,
    group: 'Design',
  },
  {
    href: '/dashboard/optimization',
    label: 'Optimisation',
    description: 'What the search changed, and what it bought',
    icon: Target,
    group: 'Design',
  },
  {
    href: '/dashboard/scenarios',
    label: 'Climate Response',
    description: 'Same site, five forms · same building, five climates — in 3D',
    icon: GitCompare,
    group: 'Design',
  },
  {
    href: '/dashboard/materials',
    label: 'Materials',
    description: 'The envelope library and the thermal properties behind it',
    icon: Layers,
    group: 'Reference',
  },
  {
    href: '/dashboard/model',
    label: 'ML Model',
    description: 'The surrogate, its validation gate and its measured accuracy',
    icon: BrainCircuit,
    group: 'Reference',
  },
  {
    href: '/dashboard/method',
    label: 'Method & Limits',
    description: 'How the numbers are produced, and what they are not',
    icon: BookOpen,
    group: 'Reference',
  },
] as const;

export const NAV_GROUPS = ['Overview', 'Design', 'Reference'] as const;

/**
 * The nav entry for a pathname, for the topbar title.
 *
 * Falls back to the longest matching prefix so a future nested route (say
 * `/dashboard/design/advanced`) still reports the section it belongs to
 * instead of falling back to a generic title.
 */
export function navItemFor(pathname: string): NavItem | undefined {
  const exact = NAV_ITEMS.find((item) => item.href === pathname);
  if (exact) return exact;

  return NAV_ITEMS.filter(
    (item) => item.href !== '/dashboard' && pathname.startsWith(`${item.href}/`),
  ).sort((a, b) => b.href.length - a.href.length)[0];
}

/** True when `href` is the section the user is currently in. */
export function isNavActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  return href !== '/dashboard' && pathname.startsWith(`${href}/`);
}
