/**
 * The one place the app starts a view transition, so support detection, the
 * reduced-motion preference and the no-animation fallback are decided once.
 *
 * A transition runs on a *root*: the whole document (`Document.startViewTransition`),
 * or one element's subtree (`Element.startViewTransition`, an element-scoped view
 * transition). Scope a transition to the part of the page that actually changes: an
 * element-scoped transition snapshots and animates only that subtree, with its
 * pseudo-element tree drawn inside it, so everything outside (the sticky header, for
 * one) stays live and keeps its normal stacking instead of being covered by the
 * transition's layers. See MDN, "Using element-scoped view transitions".
 *
 * Where the root can't start a transition (the browser lacks that API), or the user
 * asks for reduced motion, `update` simply runs, un-animated — MDN's documented
 * fallback for both APIs.
 */
import { prefersReducedMotion } from './prefersReducedMotion.ts';

export type ViewTransitionRoot = Document | Element;

/**
 * Runs `update` inside a view transition on `root`, or directly when that isn't
 * possible (see module doc). Returns the `ViewTransition` when one started, so a caller
 * can wait on `finished`; `null` when `update` ran un-animated.
 */
export function runViewTransition(root: ViewTransitionRoot, update: () => void | Promise<void>): ViewTransition | null {
  if (typeof root.startViewTransition !== 'function' || prefersReducedMotion()) {
    void update();
    return null;
  }
  return root.startViewTransition(update);
}
