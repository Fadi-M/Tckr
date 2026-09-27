/**
 * Which element page-level navigation transitions are scoped to. `App` provides a ref
 * to its `<main>` — the region that changes when a symbol opens, switches or closes —
 * so those transitions never snapshot the header (see `viewTransition.ts` for why that
 * matters). Without a provider, transitions fall back to the whole document.
 *
 * A ref rather than an element: the scope is resolved when a transition starts, never
 * during render.
 */
import { createContext, useCallback, useContext, type RefObject } from 'react';
import type { ViewTransitionRoot } from './viewTransition.ts';

export const TransitionScopeContext = createContext<RefObject<HTMLElement | null> | null>(null);

/** Returns a resolver for the current transition scope (the provided element once
 * mounted, else the document). */
export function useTransitionScope(): () => ViewTransitionRoot {
  const scopeRef = useContext(TransitionScopeContext);
  return useCallback(() => scopeRef?.current ?? document, [scopeRef]);
}
