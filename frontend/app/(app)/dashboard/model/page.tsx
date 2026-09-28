'use client';

/**
 * The standalone AI / Model route has moved.
 *
 * The surrogate is the one component whose output is learned rather than
 * derived, so it belongs with the rest of the method and fidelity discussion on
 * Method & Limits rather than as a destination of its own. This route is kept
 * so an old link still lands somewhere sensible instead of a 404.
 */

import { RouteRedirect } from '@/components/shell/RouteRedirect';

export default function ModelRedirect() {
  return (
    <RouteRedirect
      to="/dashboard/method?section=model"
      label="Method & Limits"
      reason="The surrogate is part of how these numbers are produced and what they are allowed to claim, so it now sits with the rest of the method and validation discussion."
    />
  );
}
