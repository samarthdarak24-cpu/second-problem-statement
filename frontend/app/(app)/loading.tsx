import { PageSkeleton } from '@/components/ui/primitives';

/**
 * Route-level loading state for the workspace.
 *
 * Next renders this the moment a navigation starts, before the target
 * segment's JavaScript has evaluated. Without it, a click on the sidebar
 * produced a frozen frame — the old page sat there unchanged until the
 * new one was ready, which reads as a dropped click rather than a load.
 *
 * The shape deliberately matches a metrics page (header, three metrics,
 * one panel) because that is what most workspace routes are. It is a
 * placeholder, not a prediction — it only has to be better than nothing
 * and must not reflow badly when the real content arrives.
 */
export default function WorkspaceLoading() {
  return <PageSkeleton />;
}
