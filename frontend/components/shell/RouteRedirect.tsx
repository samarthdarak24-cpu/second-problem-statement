'use client';

/**
 * Client-side redirect for a route that has moved.
 *
 * WHY NOT `redirect()` FROM `next/navigation`
 * The app is built with `output: 'export'` — a directory of static files with no
 * server at request time. A server redirect has nothing to run on, so the
 * redirect has to happen in the browser.
 *
 * The panel deliberately shows a real link as well as navigating. If the
 * automatic redirect is ever blocked, or the user has JavaScript disabled or is
 * slower than the timer, the page still tells them where the content went and
 * gives them a way to get there — a redirect that silently fails is worse than
 * no redirect at all.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ArrowRight } from 'lucide-react';

export function RouteRedirect({
  to,
  label,
  reason,
}: {
  /** Destination, including any query string. */
  to: string;
  /** What the destination is, for the link text. */
  label: string;
  /** One line on why the content moved. */
  reason: string;
}) {
  const router = useRouter();

  useEffect(() => {
    /* `replace` rather than `push`, so the moved route does not sit in the
       history and trap the back button in a redirect loop. */
    router.replace(to);
  }, [router, to]);

  return (
    <div className="page-pad page-gap">
      <div className="soft-card flex min-h-[240px] flex-col items-center justify-center gap-3 px-6 py-12 text-center">
        <p className="text-[14.5px] font-medium text-foreground">This section has moved</p>
        <p className="max-w-[460px] text-[12.5px] leading-relaxed text-muted-foreground">
          {reason}
        </p>
        <Link href={to} className="btn-secondary mt-1">
          Go to {label}
          <ArrowRight size={13} aria-hidden />
        </Link>
      </div>
    </div>
  );
}

export default RouteRedirect;
