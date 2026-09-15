/**
 * `throttle.test.ts` — the mechanism behind the "Tckr First Run" design pass's fix for
 * a hot symbol re-rendering far faster than a human can read (see `../throttle.ts`'s
 * module doc). Leading+trailing semantics: an isolated call fires immediately; a burst
 * within one window collapses to exactly one more call, at the window's end, using the
 * latest arguments.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createThrottle } from '../throttle.ts';

describe('createThrottle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires the first call immediately (leading edge)', () => {
    const fn = vi.fn();
    const throttled = createThrottle(fn, 250);

    throttled('a');

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('a');
  });

  it('collapses a burst within one window into a single trailing call carrying the latest args', () => {
    const fn = vi.fn();
    const throttled = createThrottle(fn, 250);

    throttled('first'); // leading — fires now
    throttled('second'); // suppressed
    throttled('third'); // suppressed, becomes the pending trailing call

    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(250);

    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(2, 'third');
  });

  it('never fires faster than the interval across many rapid calls', () => {
    const fn = vi.fn();
    const throttled = createThrottle(fn, 250);

    // Simulate a hot symbol: one call every 5ms for a full second (200 calls).
    for (let i = 0; i < 200; i += 1) {
      throttled(i);
      vi.advanceTimersByTime(5);
    }

    // At most one call per 250ms window across ~1000ms of elapsed time: never more
    // than 5 (with a comfortable margin for the leading-edge call).
    expect(fn.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it('allows an isolated call after the window elapses to fire immediately again', () => {
    const fn = vi.fn();
    const throttled = createThrottle(fn, 250);

    throttled('a');
    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(300);

    throttled('b');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(2, 'b');
  });

  it('cancel() drops a pending trailing call', () => {
    const fn = vi.fn();
    const throttled = createThrottle(fn, 250);

    throttled('a');
    throttled('b'); // pending trailing call

    throttled.cancel();
    vi.advanceTimersByTime(250);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('a');
  });
});
