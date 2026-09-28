/**
 * `navigate()` wrapped in a view transition — how opening, switching and closing a
 * symbol's split pane animates.
 *
 * The split layout change (hero cards collapse, list narrows to 380px, detail pane
 * appears) used to animate with CSS transitions on `max-height`, `margin-bottom` and
 * `width`. Those are layout properties, so every frame of the 480ms re-ran layout for
 * the whole page, including the 34-row table. With a view transition the layout
 * changes exactly once; the browser snapshots the old and new states and animates the
 * snapshots on the compositor (see the `::view-transition-*` rules in
 * `src/styles/tailwind.css`).
 *
 * The transition is scoped to the nearest `TransitionScopeContext` element (`App`'s
 * `<main>`), not the whole document, so the sticky header is never part of it — see
 * `viewTransition.ts` for the support detection and fallback.
 *
 * React Router's own `viewTransition` option only works in data/framework mode, and
 * always starts a document-scoped transition; this app uses the declarative
 * `<BrowserRouter>`, so the transition is started here. The update callback returns a
 * promise that resolves in the layout effect of the first render that sees the new
 * location, i.e. once the new DOM is committed, so the "new" snapshot is never taken
 * early. A timeout guards against a navigation that never commits (e.g. to the current
 * location), so the page can't get stuck mid-transition.
 */
import { useCallback, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTransitionScope } from './transitionScope.ts';
import { runViewTransition } from './viewTransition.ts';

const COMMIT_TIMEOUT_MS = 400;

/** `replace` swaps the current history entry instead of adding one — for navigation that
 * follows focus (arrowing through the board with a symbol open), where Back should leave
 * the pane, not replay every symbol passed through. */
export interface ViewTransitionNavigateOptions {
  readonly replace?: boolean;
}

export function useViewTransitionNavigate(): (
  to: string,
  options?: ViewTransitionNavigateOptions,
) => void {
  const navigate = useNavigate();
  const location = useLocation();
  const resolveScope = useTransitionScope();
  const resolveCommitted = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    resolveCommitted.current?.();
    resolveCommitted.current = null;
  }, [location.key]);

  return useCallback(
    (to: string, options?: ViewTransitionNavigateOptions) => {
      runViewTransition(
        resolveScope(),
        () =>
          new Promise<void>((resolve) => {
            resolveCommitted.current = resolve;
            setTimeout(resolve, COMMIT_TIMEOUT_MS);
            void navigate(to, { replace: options?.replace ?? false });
          }),
      );
    },
    [navigate, resolveScope],
  );
}
