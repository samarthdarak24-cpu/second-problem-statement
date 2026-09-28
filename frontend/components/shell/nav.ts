/**
 * Navigation model for the workspace shell.
 *
 * The order is the order of the user's flow, not the order of the
 * underlying pipeline. A new visitor lands on the Dashboard, walks
 * Site → Brief → Design → Analysis → Optimization, then compares across
 * climates and browses the material library. That progression is what the
 * sidebar surfaces.
 *
 * WHAT IS DELIBERATELY *NOT* HERE
 * Two things that used to be destinations are not workflow steps, and are
 * folded into the pages they belong to:
 *
 *   - **Climate Fingerprint** is a *reading of the site*, not a stage of the
 *     design. It lives as a tab on Site & Climate, next to the climate data it
 *     is derived from. `/dashboard/fingerprint` is kept as a redirect so old
 *     links still land somewhere sensible.
 *   - **AI / Model** describes how the surrogate behaves and what it is allowed
 *     to claim, which is method and fidelity — not a place to go. It lives as a
 *     section on Method & Limits, and `/dashboard/model` redirects there.
 *
 * That leaves eight primary items. Method & Limits and Settings are reference
 * and configuration rather than workflow, so they sit in `UTILITY_LINKS` and
 * render small in the sidebar footer instead of competing for attention with
 * the eight steps a user actually moves through.
 *
 * `group` drives the sidebar's section headings. It is presentation only — the
 * route is the identity, so adding a page never means touching the shell.
 *
 * Every href is namespaced under `/dashboard`, which leaves `/` free
 * for the landing page and `/login` free for sign-in.
 */

import type { LucideIcon } from 'lucide-react';
import {
  Activity,
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

export interface NavItem {
  href: string;
  label: string;
  /** Short label used for the sidebar — when label is too long for the rail. */
  shortLabel?: string;
  description: string;
  icon: LucideIcon;
  group: 'Main' | 'Design' | 'Compare' | 'Reference' | 'System';
}

/**
 * The eight primary items, in workflow order.
 *
 * Nothing else belongs here. A page earns a primary slot only if it is a step
 * the user moves through while designing; anything that is reference material,
 * a reading of existing data, or configuration goes elsewhere.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  /* ---------------- MAIN ---------------- */
  {
    href: '/dashboard',
    label: 'Dashboard',
    description: 'How is my current design doing?',
    icon: LayoutDashboard,
    group: 'Main',
  },

  /* ---------------- DESIGN ---------------- */
  {
    href: '/dashboard/climate',
    label: 'Site & Climate',
    shortLabel: 'Site',
    description: 'What does this location require?',
    icon: MapPin,
    group: 'Design',
  },
  {
    href: '/dashboard/brief',
    label: 'Design Brief',
    shortLabel: 'Brief',
    description: 'Requirements, moisture, stress and deployability',
    icon: ClipboardList,
    group: 'Design',
  },
  {
    href: '/dashboard/design',
    label: 'Design Studio',
    description: 'What am I designing?',
    icon: SlidersHorizontal,
    group: 'Design',
  },
  {
    href: '/dashboard/analysis',
    label: 'Thermal Analysis',
    description: 'What is happening thermally?',
    icon: Activity,
    group: 'Design',
  },
  {
    href: '/dashboard/optimization',
    label: 'Optimization',
    description: 'What did the optimizer change?',
    icon: Target,
    group: 'Design',
  },

  /* ---------------- COMPARE ---------------- */
  {
    href: '/dashboard/scenarios',
    label: 'Climate Response',
    description: 'How does the design change across climates?',
    icon: GitCompare,
    group: 'Compare',
  },

  /* ---------------- REFERENCE ---------------- */
  {
    href: '/dashboard/materials',
    label: 'Materials',
    description: 'The envelope library',
    icon: Layers,
    group: 'Reference',
  },
] as const;

/**
 * Reference and configuration pages.
 *
 * Reachable, but not competing with the workflow. They render as small text
 * links in the sidebar footer and appear in the mobile "More" sheet, so nothing
 * becomes unreachable — it just stops asking for equal attention.
 */
export const UTILITY_LINKS: readonly NavItem[] = [
  {
    href: '/dashboard/method',
    label: 'Method & Limits',
    description: 'How these numbers are produced, and what they do not claim',
    icon: BookOpen,
    group: 'Reference',
  },
  {
    href: '/dashboard/settings',
    label: 'Settings',
    description: 'Backend, data sources and developer options',
    icon: Settings,
    group: 'System',
  },
] as const;

/** Every routable entry, primary and utility, for title lookup and mobile nav. */
export const ALL_NAV_ITEMS: readonly NavItem[] = [...NAV_ITEMS, ...UTILITY_LINKS];

export const NAV_GROUPS = ['Main', 'Design', 'Compare', 'Reference'] as const;

/**
 * The nav entry for a pathname, for the topbar title.
 *
 * Searches the utility links too, so a page like Method & Limits still reports
 * its own title rather than falling back to a generic one. Falls back to the
 * longest matching prefix so a future nested route (say
 * `/dashboard/design/advanced`) still reports the section it belongs to.
 */
export function navItemFor(pathname: string): NavItem | undefined {
  /* The app builds with `trailingSlash: true`, so `usePathname()`
     returns `/dashboard/` while every `href` in this model is written
     without a trailing slash. Comparing the two directly never matched,
     which meant `navItemFor('/dashboard/')` fell through to the
     `startsWith` fallback — and that fallback deliberately skips
     `/dashboard` — so it returned `undefined` and the Topbar rendered
     its generic "Thermal Shelter" fallback title on the home page.

     Normalising here rather than at each call site keeps the fix in one
     place and makes the function behave the same for both styles. */
  const normalised =
    pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;

  const exact = ALL_NAV_ITEMS.find((item) => item.href === normalised);
  if (exact) return exact;

  return ALL_NAV_ITEMS.filter(
    (item) => item.href !== '/dashboard' && normalised.startsWith(`${item.href}/`),
  ).sort((a, b) => b.href.length - a.href.length)[0];
}

/** True when `href` is the section the user is currently in. */
export function isNavActive(pathname: string, href: string): boolean {
  const normalised =
    pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  if (normalised === href) return true;
  return href !== '/dashboard' && normalised.startsWith(`${href}/`);
}
