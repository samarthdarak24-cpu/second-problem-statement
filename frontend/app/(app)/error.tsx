'use client';

/**
 * Workspace error boundary.
 *
 * Before this existed, a throw anywhere inside the `(app)` group — a bad
 * thermal record, a malformed station, a 3D geometry failure — unmounted
 * the whole workspace and left a blank page with the shell gone. The user
 * lost the navigation too, which meant the only recovery was a manual
 * reload.
 *
 * This boundary keeps the failure *inside* the content area: the sidebar
 * and topbar survive, the message says plainly what happened and that the
 * engines did not run, and there is a real retry. The copy deliberately
 * does not blame the user or claim the design was lost — the store is
 * still intact and `reset()` re-renders from it.
 *
 * This is error *presentation*. Nothing here catches, swallows or alters
 * a calculation error; it only decides what the user sees afterwards.
 */

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Keep the real error in the console for debugging. The UI stays
    // calm; the developer still gets the stack.
    console.error('[workspace] unhandled error', error);
  }, [error]);

  return (
    <div className="page-pad">
      <div
        className="mx-auto flex max-w-[560px] flex-col items-start gap-4 rounded-[20px] border px-6 py-7"
        style={{
          borderColor: 'hsl(var(--destructive) / 0.28)',
          background: 'hsl(var(--destructive) / 0.05)',
        }}
        role="alert"
      >
        <span
          aria-hidden
          className="flex h-10 w-10 items-center justify-center rounded-full"
          style={{ background: 'hsl(var(--destructive) / 0.12)' }}
        >
          <AlertTriangle size={18} style={{ color: 'hsl(var(--destructive))' }} aria-hidden />
        </span>

        <div>
          <h1 className="font-display text-[20px] font-semibold tracking-[-0.02em] text-foreground">
            This view could not be rendered
          </h1>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
            Something failed while drawing this page. Your design, the climate record and
            the last simulation result are still loaded — nothing was recalculated or
            cleared. Retry to render the view again.
          </p>
        </div>

        {error.message ? (
          <details className="w-full">
            <summary className="cursor-pointer text-[12px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Technical detail
            </summary>
            <pre className="mt-2 max-h-[180px] overflow-auto rounded-lg border bg-panel px-3 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
              {error.message}
              {error.digest ? `\n\ndigest: ${error.digest}` : ''}
            </pre>
          </details>
        ) : null}

        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-[12.5px] font-semibold text-background transition-transform hover:-translate-y-0.5"
        >
          <RefreshCw size={13} aria-hidden />
          Retry this view
        </button>
      </div>
    </div>
  );
}
