/**
 * `navigate()` wrapped in the View Transitions API — how opening or closing a symbol's
 * split pane animates.
 *
 * The split layout change (hero cards collapse, list narrows to 380px, detail pane
 * appears) used to animate with CSS transitions on `max-height`, `margin-bottom` and
 * `width`. Those are layout properties, so every frame of the 480ms re-ran layout for
 * the whole page, including the 34-row table. With a view transition the layout
 * changes exactly once; the browser snapshots the old and new states and animates the
 * snapshots on the compositor (see the `::view-transition-*` rules in
 * `src/styles/tailwind.css`).
 *
 * React Router's own `viewTransition` option only works with a data router, and this
 * app uses the declarative `<BrowserRouter>`, so the transition is started here. The
 * update callback returns a promise that resolves in the layout effect of the first
 * render that sees the new location, i.e. once the new DOM is committed, so the "new"
 * snapshot is never taken early. A timeout guards against a navigation that never
 * commits (e.g. to the current location), so the page can't get stuck mid-transition.
 *
 * No transition (a plain `navigate`) when the browser lacks the API or the user asks
 * for reduced motion.
 */
import { useCallback, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const COMMIT_TIMEOUT_MS = 400;

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useViewTransitionNavigate(): (to: string) => void {
  const navigate = useNavigate();
  const location = useLocation();
  const resolveCommitted = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    resolveCommitted.current?.();
    resolveCommitted.current = null;
  }, [location.key]);

  return useCallback(
    (to: string) => {
      if (typeof document.startViewTransition !== 'function' || prefersReducedMotion()) {
        navigate(to);
        return;
      }
      document.startViewTransition(
        () =>
          new Promise<void>((resolve) => {
            resolveCommitted.current = resolve;
            setTimeout(resolve, COMMIT_TIMEOUT_MS);
            navigate(to);
          }),
      );
    },
    [navigate],
  );
}
