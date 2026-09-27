/**
 * `runViewTransition` — the one place a view transition starts: it runs on the given
 * root when that root supports it, and otherwise (no API, or reduced motion) applies
 * the update un-animated.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runViewTransition } from '../viewTransition.ts';

function stubReducedMotion(reduce: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({ matches: reduce && query.includes('reduce') }) as MediaQueryList),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runViewTransition', () => {
  it('starts the transition on the given element and hands back the ViewTransition', () => {
    stubReducedMotion(false);
    const transition = { finished: Promise.resolve() } as unknown as ViewTransition;
    const el = document.createElement('main');
    el.startViewTransition = vi.fn(() => transition);
    const update = vi.fn();

    expect(runViewTransition(el, update)).toBe(transition);
    expect(el.startViewTransition).toHaveBeenCalledWith(update);
  });

  it('applies the update un-animated when the root has no view transition API', () => {
    stubReducedMotion(false);
    const el = document.createElement('main');
    const update = vi.fn();

    expect(runViewTransition(el, update)).toBeNull();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('applies the update un-animated under reduced motion, even when supported', () => {
    stubReducedMotion(true);
    const el = document.createElement('main');
    el.startViewTransition = vi.fn();
    const update = vi.fn();

    expect(runViewTransition(el, update)).toBeNull();
    expect(el.startViewTransition).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
  });
});
