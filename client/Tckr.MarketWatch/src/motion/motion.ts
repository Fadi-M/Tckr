/**
 * The app's door to GSAP — see `gsap.ts` for why that module is only ever loaded
 * dynamically.
 *
 * Every GSAP moment in the app is an *earned* one (DESIGN.md › Moments): something
 * changed while the page was open. None of them is on first paint, so none of them
 * needs GSAP synchronously; `preloadMotion()` fetches the chunk once the page is idle,
 * so by the time a moment happens it is already here. A moment that fires before the
 * chunk arrives starts a beat late rather than blocking anything; the element already
 * sits in its finished state underneath.
 *
 * `useMotion` is the React side: the same job as `@gsap/react`'s `useGSAP` (run inside
 * a `gsap.context()` scoped to an element, revert everything it made on cleanup, so
 * StrictMode's double-invoked effects are harmless), without `useGSAP`'s static
 * `import gsap`, which would put GSAP back in the entry chunk.
 */
import { useLayoutEffect, type DependencyList, type RefObject } from 'react';
import { prefersReducedMotion } from '../components/prefersReducedMotion.ts';

export type Motion = typeof import('./gsap.ts');
type MotionContext = ReturnType<Motion['gsap']['context']>;

let loaded: Motion | null = null;
let pending: Promise<Motion> | null = null;

/** Loads GSAP (once) and resolves with it. */
export function loadMotion(): Promise<Motion> {
  pending ??= import('./gsap.ts').then((motion) => {
    loaded = motion;
    return motion;
  });
  return pending;
}

/** GSAP if it has already loaded, else `null` — for the few callers that must decide
 * synchronously (the board's re-rank reads positions during render). */
export function loadedMotion(): Motion | null {
  return loaded;
}

/** Fetches GSAP once the page has nothing better to do. */
export function preloadMotion(): void {
  const load = () => void loadMotion().catch(() => undefined);
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(load, { timeout: 2000 });
  } else {
    setTimeout(load, 200);
  }
}

/**
 * Runs `build` in a GSAP context scoped to `scope` (selector text inside `build`
 * resolves within it), and reverts everything it created when `deps` change or the
 * component unmounts. `build: null` means "nothing to play".
 *
 * Nothing plays under reduced motion: every element this drives is rendered in its
 * finished state, so skipping the animation *is* the reduced-motion fallback. Runs in
 * a layout effect, so when GSAP is already loaded the first frame is already the first
 * frame of the animation, never a flash of the end state.
 */
export function useMotion(
  scope: RefObject<Element | null>,
  build: ((motion: Motion, root: Element) => void) | null,
  deps: DependencyList,
): void {
  useLayoutEffect(() => {
    if (build === null || prefersReducedMotion()) {
      return undefined;
    }
    let context: MotionContext | null = null;
    let cancelled = false;
    const run = (motion: Motion) => {
      const root = scope.current;
      if (cancelled || root === null) {
        return;
      }
      context = motion.gsap.context(() => build(motion, root), root);
    };
    const ready = loadedMotion();
    if (ready !== null) {
      run(ready);
    } else {
      loadMotion().then(run, () => undefined);
    }
    return () => {
      cancelled = true;
      context?.revert();
    };
    // `build` is deliberately not a dependency: callers pass a fresh closure every
    // render, and `deps` names what should replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
