import Link from 'next/link';
import { Logo } from './visuals';

/**
 * The landing page footer.
 *
 * Carries the honesty statement in full rather than a link to it. A visitor who
 * reads only the top and the bottom of this page should still come away knowing
 * these are model estimates, not measurements — that is the one claim this
 * project cannot afford to bury.
 */

const COLUMNS = [
  {
    heading: 'Product',
    links: [
      { href: '/dashboard', label: 'Overview' },
      { href: '/dashboard/design', label: 'Design Studio' },
      { href: '/dashboard/climate', label: 'Climate' },
      { href: '/dashboard/analysis', label: 'Thermal Analysis' },
    ],
  },
  {
    heading: 'Reference',
    links: [
      { href: '/dashboard/materials', label: 'Materials' },
      { href: '/dashboard/model', label: 'ML Model' },
      { href: '/dashboard/method', label: 'Method & Limits' },
      { href: '/login', label: 'Sign in' },
    ],
  },
];

export function MarketingFooter() {
  return (
    <footer className="border-t bg-card">
      <div className="mx-auto w-full max-w-[1200px] px-5 py-14 sm:px-8">
        <div className="grid gap-10 lg:grid-cols-[1.6fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <Logo size={30} className="text-primary" />
              <span className="font-display text-[15px] font-bold tracking-[-0.02em]">
                Thermal Shelter
              </span>
            </div>
            <p className="mt-4 max-w-[380px] text-[13px] leading-relaxed text-muted-foreground">
              A climate-responsive shelter design tool built for{' '}
              <span className="font-medium text-foreground">
                Smart India Hackathon, Problem Statement 51
              </span>
              . Parametric geometry, a monthly heat balance, ISO 7730 comfort and a
              multi-objective envelope search — in one pipeline you can inspect end to end.
            </p>
            <p className="mt-5 max-w-[420px] text-[12px] leading-relaxed text-muted-foreground/80">
              <span className="font-semibold text-warning">Model estimates, not measurements.</span>{' '}
              Every figure is the output of a simplified quasi-steady-state monthly heat balance.
              Use it to compare options; validate with measured data before construction.
            </p>
          </div>

          {COLUMNS.map((column) => (
            <div key={column.heading}>
              <p className="kicker">{column.heading}</p>
              <ul className="mt-3 space-y-2">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-[13px] text-muted-foreground transition-colors hover:text-primary"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-6 text-[11.5px] text-muted-foreground/75">
          <span>Next.js · React · TypeScript · Three.js · FastAPI</span>
          <span aria-hidden className="hidden sm:inline">
            ·
          </span>
          <span>ISO 7730 PMV/PPD · ASHRAE 55 adaptive comfort</span>
          <span className="ml-auto">Built for Smart India Hackathon</span>
        </div>
      </div>
    </footer>
  );
}
