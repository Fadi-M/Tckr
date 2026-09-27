/**
 * Test support for GSAP-driven motion (`src/motion`). jsdom paints nothing, so these
 * tests assert what a moment leaves behind (its end state, its accessible text, that
 * it was skipped), never individual frames.
 */
import { act } from 'react';
import { vi } from 'vitest';
import { loadMotion } from '../motion.ts';

/** Makes `prefersReducedMotion()` answer `reduce`. jsdom has no `matchMedia` at all, so
 * pair with `unstubReducedMotion` in `afterEach`. */
export function stubReducedMotion(reduce: boolean): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

export function unstubReducedMotion(): void {
  Reflect.deleteProperty(window, 'matchMedia');
}

/** Waits for GSAP to load and for any moment that was waiting on it to start. */
export async function flushMotion(): Promise<void> {
  await act(async () => {
    await loadMotion();
    await Promise.resolve();
  });
}

/** Loads GSAP before a test renders, so a moment starts inside the render's own layout
 * effect. A test can then check the moment's first frame synchronously, straight after
 * the render or `act` that started it: GSAP's clock only advances on animation frames,
 * so nothing can have moved yet, however loaded the machine is. (Pausing or zeroing
 * the global timeline to "freeze" it instead also withholds the immediate renders a
 * first frame is made of.) Pair with `resetMotion` in `afterEach`. */
export async function primeMotion(): Promise<void> {
  await loadMotion();
}

/** Kills whatever a test left running. */
export async function resetMotion(): Promise<void> {
  const { gsap } = await loadMotion();
  gsap.globalTimeline.getChildren(true, true, true).forEach((animation) => animation.kill());
}

/** Jumps every running GSAP animation to its end, as if it had played out. */
export async function finishMotion(): Promise<void> {
  const { gsap } = await loadMotion();
  act(() => {
    for (const animation of gsap.globalTimeline.getChildren(true, true, true)) {
      animation.progress(1);
    }
  });
}
