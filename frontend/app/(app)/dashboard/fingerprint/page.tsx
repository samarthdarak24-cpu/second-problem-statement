'use client';

/**
 * The standalone Climate Fingerprint route has moved.
 *
 * The fingerprint is a reading of the site, not a step in the workflow, so it
 * now lives as a tab on Site & Climate. This route is kept so that an old link
 * or a bookmark still lands somewhere sensible instead of a 404.
 */

import { RouteRedirect } from '@/components/shell/RouteRedirect';

export default function FingerprintRedirect() {
  return (
    <RouteRedirect
      to="/dashboard/climate?tab=fingerprint"
      label="Site & Climate"
      reason="The climate fingerprint is a reading of the site, so it now lives as a tab on Site & Climate alongside the climate data it is derived from."
    />
  );
}
